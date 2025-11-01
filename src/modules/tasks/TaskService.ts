import type { Client } from 'discord.js';
import { TextChannel } from 'discord.js';
import type { TaskSubmission } from '../../models/TaskSubmission.js';
import { SubmissionStatus } from '../../models/TaskSubmission.js';
import { postToAdminChannel, notifyUser, archiveSubmission, updateTaskCounter } from './SubmissionActions.js';
import { isTextChannel } from '../../utils/ChannelUtils.js';
import type { ITaskRepository } from '../../core/database/interfaces/ITaskRepo.js';
import { getTaskDisplayName } from './TaskEmbeds.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';

const MAX_SCREENSHOTS = 10;

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

        const taskEvent = await this.repo.getTaskEventById(taskEventId);
        if (!taskEvent) {
            throw new Error(`Task event ${taskEventId} not found`);
        }
        const taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);

        const submission: TaskSubmission = {
            id: Date.now().toString(),
            userId,
            taskEventId,
            screenshotUrls: [],
            status: SubmissionStatus.Pending,
            createdAt: new Date(),
            alreadyApproved: hasApproved,
            taskName,
        };

        await this.repo.createSubmission(submission);
        return submission;
    }

    async completeSubmission(client: Client, submissionId: string, screenshotUrls: string[], services: ServiceContainer, notes?: string): Promise<TaskSubmission | null> {
        const submission = await this.repo.getSubmissionById(submissionId);
        if (!submission) return null;

        submission.screenshotUrls = screenshotUrls.slice(0, MAX_SCREENSHOTS);

        if (notes !== undefined) {
            submission.notes = notes;
        } else {
            delete submission.notes;
        }

        if (!submission.taskName) {
            const taskEvent = await this.repo.getTaskEventById(submission.taskEventId);
            if (taskEvent) {
                submission.taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);
            }
        }

        await postToAdminChannel(client, submission, services);
        await this.repo.createSubmission(submission);
        return submission;
    }

    async updateSubmissionStatus(client: Client, submissionId: string, newStatus: SubmissionStatus.Approved | SubmissionStatus.Rejected, reviewedBy: string, rejectionReason?: string): Promise<TaskSubmission | null> {
        const submission = await this.repo.getSubmissionById(submissionId);
        if (!submission) return null;

        submission.status = newStatus;
        submission.reviewedBy = reviewedBy;
        submission.reviewedAt = new Date();
        if (newStatus === SubmissionStatus.Rejected && rejectionReason !== undefined) {
            submission.rejectionReason = rejectionReason;
        }

        if (!submission.taskName) {
            const taskEvent = await this.repo.getTaskEventById(submission.taskEventId);
            if (taskEvent) {
                submission.taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);
            }
        }

        await this.repo.updateSubmissionStatus(submissionId, newStatus, reviewedBy);
        await this.repo.createSubmission(submission);

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

    async updateSubmissionTier(
        client: Client,
        submissionId: string,
        tier: 'bronze' | 'silver' | 'gold',
        reviewedBy: string
    ): Promise<TaskSubmission | null> {
        const TIER_MAP = {
            bronze: { status: SubmissionStatus.Bronze, rolls: 1 },
            silver: { status: SubmissionStatus.Silver, rolls: 2 },
            gold: { status: SubmissionStatus.Gold, rolls: 3 },
        } as const;

        const tierInfo = TIER_MAP[tier];
        if (!tierInfo) return null;

        const submission = await this.repo.getSubmissionById(submissionId);
        if (!submission) return null;

        // Retrieve any previous submission by the same user for this task
        const existing = await this.repo.getSubmissionByUserAndTask(submission.userId, submission.taskEventId);

        const previousRolls = existing?.prizeRolls ?? 0;
        if (previousRolls >= tierInfo.rolls) {
            // Already equal or higher tier
            return null;
        }

        // Update submission details
        submission.status = tierInfo.status;
        submission.prizeRolls = tierInfo.rolls;
        submission.reviewedBy = reviewedBy;
        submission.reviewedAt = new Date();

        if (!submission.taskName) {
            const taskEvent = await this.repo.getTaskEventById(submission.taskEventId);
            if (taskEvent) {
                submission.taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);
            }
        }

        // Persist updates
        await this.repo.updateSubmissionStatus(submissionId, submission.status, reviewedBy);
        await this.repo.createSubmission(submission);

        // Notify, archive, and update counters
        await notifyUser(client, submission);
        await archiveSubmission(client, submission);
        await updateTaskCounter(client, submission.taskEventId, submission.userId, this.repo, submission.status);

        // --- Cleanup original admin messages ---
        const adminChannel = client.channels.cache.find(
            (c): c is TextChannel => isTextChannel(c) && c.name === 'task-admin'
        );
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
        const pending = submissions.find(
            (s) =>
                s.userId === userId &&
                s.status === SubmissionStatus.Pending &&
                (!s.screenshotUrls || s.screenshotUrls.length === 0) &&
                (taskEventId ? s.taskEventId === taskEventId : true)
        );
        if (pending && !pending.taskName) {
            const taskEvent = await this.repo.getTaskEventById(pending.taskEventId);
            if (taskEvent) {
                pending.taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);
                await this.repo.createSubmission(pending);
            }
        }
        return pending;
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