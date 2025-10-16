import type { Client } from 'discord.js';
import { TextChannel } from 'discord.js';
import type { TaskSubmission } from '../../models/TaskSubmission';
import { SubmissionStatus } from '../../models/TaskSubmission';
import { postToAdminChannel, notifyUser, archiveSubmission, updateTaskCounter } from './SubmissionActions';
import { isTextChannel } from '../../utils/ChannelUtils';
import type { ITaskRepository } from '../../core/database/interfaces/ITaskRepo';

export class TaskService {
    private pendingTaskMap = new Map<string, string>();
    constructor(private repo: ITaskRepository) { }

    get repository() {
        return this.repo;
    }

    async createSubmission(userId: string, taskEventId: string): Promise<TaskSubmission> {
        // Check if this user already has an approved submission for this task
        const existing = await this.repo.getSubmissionsByUser(userId);
        const hasApproved = existing.some(
            s => s.userId === userId && s.taskEventId === taskEventId && s.status === SubmissionStatus.Approved
        );

        const submission: TaskSubmission = {
            id: Date.now().toString(),
            userId,
            taskEventId,
            screenshotUrls: [],
            status: SubmissionStatus.Pending,
            createdAt: new Date(),
            alreadyApproved: hasApproved
        };

        await this.repo.createSubmission(submission);
        return submission;
    }

    async completeSubmission(client: Client, submissionId: string, screenshotUrls: string[], notes?: string): Promise<TaskSubmission | null> {
        const submissions = await this.repo.getSubmissionsForTask("");
        const submission = submissions.find((s) => s.id === submissionId);
        if (!submission) return null;

        submission.screenshotUrls = screenshotUrls;

        if (notes !== undefined) {
            submission.notes = notes;
        } else {
            delete submission.notes;
        }

        await this.repo.createSubmission(submission);

        await postToAdminChannel(client, submission);
        return submission;
    }

    async updateSubmissionStatus(client: Client, submissionId: string, newStatus: SubmissionStatus.Approved | SubmissionStatus.Rejected, reviewedBy: string, rejectionReason?: string): Promise<TaskSubmission | null> {
        const allSubs = await this.repo.getSubmissionsForTask("");
        const submission = allSubs.find((s) => s.id === submissionId);
        if (!submission) return null;

        submission.status = newStatus;
        submission.reviewedBy = reviewedBy;
        submission.reviewedAt = new Date();
        if (newStatus === SubmissionStatus.Rejected && rejectionReason !== undefined) {
            submission.rejectionReason = rejectionReason;
        }

        await this.repo.updateSubmissionStatus(submissionId, newStatus, reviewedBy);

        await notifyUser(client, submission);
        await archiveSubmission(client, submission);
        await updateTaskCounter(client, submission.taskEventId);

        // Delete original messages from admin channel
        const adminChannel = client.channels.cache.find((c): c is TextChannel => isTextChannel(c) && c.name === 'task-admin');
        if (adminChannel) {
            if (submission.message) {
                try {
                    const msg = await adminChannel.messages.fetch(submission.message);
                    if (msg) await msg.delete();
                } catch (err) {
                    console.warn(`[Admin Embed Cleanup Error]:`, err);
                }
            }
            if (submission.screenshotMessage) {
                try {
                    const msg = await adminChannel.messages.fetch(submission.screenshotMessage);
                    if (msg) await msg.delete();
                } catch (err) {
                    console.warn(`[Screenshot Message Cleanup Error]:`, err);
                }
            }
        }

        return submission;
    }

    async getPendingSubmission(
        userId: string,
        taskEventId?: string
    ): Promise<TaskSubmission | undefined> {
        const submissions = await this.repo.getSubmissionsByUser(userId);
        return submissions.find(
            (s) =>
                s.userId === userId &&
                s.status === SubmissionStatus.Pending &&
                (!s.screenshotUrls || s.screenshotUrls.length === 0) &&
                (taskEventId ? s.taskEventId === taskEventId : true)
        );
    }


    setPendingTask(userId: string, taskEventId: string) {
        this.pendingTaskMap.set(userId, taskEventId);
    }

    consumePendingTask(userId: string): string | undefined {
        const taskId = this.pendingTaskMap.get(userId);
        this.pendingTaskMap.delete(userId);
        return taskId;
    }
}