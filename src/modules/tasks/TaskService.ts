import fs from 'fs';
import path from 'path';
import type { Client } from 'discord.js';
import { TextChannel } from 'discord.js';
import type { TaskSubmission } from '../../models/TaskSubmission';
import { SubmissionStatus } from '../../models/TaskSubmission';
import { postToAdminChannel, notifyUser, archiveSubmission, updateTaskCounter } from './SubmissionActions';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { isTextChannel } from '../../utils/ChannelUtils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const submissionsPath = path.join(__dirname, '../../data/submissions.json');

const pendingTaskMap = new Map<string, string>(); // userId -> taskId

let submissions: TaskSubmission[] = fs.existsSync(submissionsPath)
    ? JSON.parse(fs.readFileSync(submissionsPath, "utf8"))
    : [];

function saveSubmissions() {
    fs.writeFileSync(submissionsPath, JSON.stringify(submissions, null, 2));
}

export function createSubmission(userId: string, taskEventId: string): TaskSubmission {
    // Check if this user already has an approved submission for this task
    const hasApproved = submissions.some(
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

    submissions.push(submission);
    saveSubmissions();
    return submission;
}

export async function completeSubmission(client: Client, submissionId: string, screenshotUrls: string[], notes?: string): Promise<TaskSubmission | null> {
    const submission = submissions.find((s) => s.id === submissionId);
    if (!submission) return null;

    submission.screenshotUrls = screenshotUrls;

    if (notes !== undefined) {
        submission.notes = notes;
    } else {
        delete submission.notes;
    }

    saveSubmissions();

    await postToAdminChannel(client, submission);
    return submission;
}

export async function updateSubmissionStatus(client: Client, submissionId: string, newStatus: SubmissionStatus.Approved | SubmissionStatus.Rejected, reviewedBy: string, rejectionReason?: string): Promise<TaskSubmission | null> {
    const submission = submissions.find((s) => s.id === submissionId);
    if (!submission) return null;

    submission.status = newStatus;
    submission.reviewedBy = reviewedBy;
    submission.reviewedAt = new Date();
    if (newStatus === SubmissionStatus.Rejected && rejectionReason !== undefined) {
        submission.rejectionReason = rejectionReason;
    }

    saveSubmissions();

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

export function getPendingSubmission(userId: string, taskEventId?: string): TaskSubmission | undefined {
    return submissions.find(
        (s) => s.userId === userId &&
            s.status === SubmissionStatus.Pending &&
            (!s.screenshotUrls || s.screenshotUrls.length === 0) &&
            (taskEventId ? s.taskEventId === taskEventId : true)
    );
}

export function setPendingTask(userId: string, taskEventId: string) {
    pendingTaskMap.set(userId, taskEventId);
}

export function consumePendingTask(userId: string): string | undefined {
    const taskId = pendingTaskMap.get(userId);
    pendingTaskMap.delete(userId);
    return taskId;
}