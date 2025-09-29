import fs from 'fs';
import path from 'path';
import type { Client } from 'discord.js';
import type { TaskSubmission } from '../../models/TaskSubmission';
import { SubmissionStatus } from '../../models/TaskSubmission';
import { postToAdminChannel, notifyUser, archiveSubmission, updateTaskCounter } from './SubmissionActions';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const submissionsPath = path.join(__dirname, '../../data/submissions.json');

let submissions: TaskSubmission[] = fs.existsSync(submissionsPath)
    ? JSON.parse(fs.readFileSync(submissionsPath, "utf8"))
    : [];

function saveSubmissions() {
    fs.writeFileSync(submissionsPath, JSON.stringify(submissions, null, 2));
}

export function createSubmission(userId: string, taskEventId: string): TaskSubmission {
    const submission: TaskSubmission = {
        id: Date.now().toString(),
        userId,
        taskEventId,
        screenshotUrl: "",
        status: SubmissionStatus.Pending,
        createdAt: new Date(),
    };

    submissions.push(submission);
    saveSubmissions;
    return submission;
}

export async function completeSubmission(client: Client, submissionId: string, screenshotUrl: string, notes?: string): Promise<TaskSubmission | null> {
    const submission = submissions.find((s) => s.id === submissionId);
    if (!submission) return null;

    submission.screenshotUrl = screenshotUrl;

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

    return submission;
}

export function getPendingSubmission(userId: string): TaskSubmission | undefined {
    return submissions.find(
        (s) => s.userId === userId &&
            s.status === SubmissionStatus.Pending &&
            !s.screenshotUrl
    );
}