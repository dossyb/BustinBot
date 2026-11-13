import { randomUUID } from "node:crypto";
import type { Client } from "discord.js";
import { maxBy } from "es-toolkit";
import Fuse, { type IFuseOptions } from "fuse.js";
import type { Task } from "../../models/Task.js";
import type { TaskSubmission } from "../../models/TaskSubmission.js";
import { SubmissionStatus } from "../../models/TaskSubmission.js";
import { postToAdminChannel, notifyUser, archiveSubmission, updateTaskCounter } from "./SubmissionActions.js";
import { configuredChannel } from "../../utils/ChannelUtils.js";
import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo.js";
import { getTaskDisplayName } from "./TaskEmbeds.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { calculateTaskStreakSummary } from "./TaskStreaks.js";
import { ensureTaskLeaderboardsInitialized, getStatusPoints } from "./TaskLeaderboards.js";
import type { UserStats } from "../../models/UserStats.js";

const MAX_SCREENSHOTS = 10;

export const TIER_STAT_MAP: Record<string, keyof UserStats> = {
    bronze: "tasksCompletedBronze",
    silver: "tasksCompletedSilver",
    gold: "tasksCompletedGold",
};

const TASK_SEARCH_OPTIONS: IFuseOptions<Task> = {
    keys: [
        { name: "id", weight: 0.5 },
        { name: "taskName", weight: 0.35 },
        { name: "shortName", weight: 0.15 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
};

export type SubmitOutcome =
    | { result: "submitted"; submission: TaskSubmission }
    | { result: "taskNotFound" }
    | { result: "adminsUnreachable" }
    | { result: "alreadySubmitted" };

export class TaskService {
    private tasks: Map<string, Task> | null = null;
    private search: Fuse<Task> | null = null;

    constructor(private repo: ITaskRepository) { }

    get repository() {
        return this.repo;
    }

    async getAllTasks(): Promise<Task[]> {
        this.tasks ??= new Map((await this.repo.getAllTasks()).map((task) => [task.id, task]));
        return [...this.tasks.values()];
    }

    async searchTasks(query: string, limit: number): Promise<Task[]> {
        this.search ??= new Fuse(await this.getAllTasks(), TASK_SEARCH_OPTIONS);
        return this.search.search(query, { limit }).map((result) => result.item);
    }

    async createTask(task: Task): Promise<void> {
        await this.repo.createTask(task);
        this.keep([task]);
    }

    async addTask(task: Task): Promise<boolean> {
        const added = await this.repo.addTask(task);
        if (added) this.keep([task]);
        return added;
    }

    async seedTasks(tasks: Task[]): Promise<void> {
        await this.repo.seedTasks(tasks);
        this.keep(tasks);
    }

    private keep(tasks: Task[]): void {
        if (!this.tasks) return;
        for (const task of tasks) this.tasks.set(task.id, task);
        this.search = null;
    }

    async incrementWeight(id: string, amount = 1): Promise<void> {
        await this.repo.incrementWeight(id, amount);
        const kept = this.tasks?.get(id);
        if (kept) kept.weight = (kept.weight ?? 0) + amount;
    }

    async completeSubmission(client: Client, userId: string, taskEventId: string, screenshotUrls: string[], services: ServiceContainer, notes?: string): Promise<SubmitOutcome> {
        const taskEvent = await this.repo.getTaskEventById(taskEventId);
        if (!taskEvent) {
            await this.repo.deleteSubmissionDraft(userId);
            return { result: "taskNotFound" };
        }

        const now = new Date();
        const submission: TaskSubmission = {
            id: randomUUID(),
            userId,
            taskEventId,
            taskName: getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount),
            screenshotUrls: screenshotUrls.slice(0, MAX_SCREENSHOTS),
            ...(notes !== undefined ? { notes } : {}),
            status: SubmissionStatus.Pending,
            createdAt: now,
            submittedAt: now,
        };

        let posted: boolean;
        try {
            posted = await postToAdminChannel(client, submission, services);
        } catch (err) {
            console.warn(`[TaskService] Couldn't post submission ${submission.id} for review:`, err);
            return { result: "adminsUnreachable" };
        }
        if (!posted) return { result: "adminsUnreachable" };

        let submitted: boolean;
        try {
            submitted = await this.repo.submitDraft(submission);
        } catch (err) {
            await this.removeReviewMessages(client, submission, services);
            throw err;
        }
        if (!submitted) {
            await this.removeReviewMessages(client, submission, services);
            return { result: "alreadySubmitted" };
        }
        return { result: "submitted", submission };
    }

    async updateSubmissionStatus(
        client: Client,
        submissionId: string,
        newStatus: SubmissionStatus.Approved | SubmissionStatus.Rejected,
        reviewedBy: string,
        services: ServiceContainer,
        rejectionReason?: string
    ): Promise<(TaskSubmission & { archived: boolean }) | null> {
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

        if (!(await this.repo.updateSubmissionStatus(submissionId, newStatus, reviewedBy))) return null;
        await this.repo.createSubmission(submission);

        if (newStatus !== SubmissionStatus.Rejected) {
            await this.addCompletedUser(submission.taskEventId, submission.userId);
        }

        try {
            await notifyUser(client, submission);
        } catch (err) {
            console.warn(`[TaskService] Failed to DM user ${submission.userId} about ${submission.id}:`, err);
        }

        let archived = false;
        try {
            archived = await archiveSubmission(client, submission, services);
        } catch (err) {
            console.warn(`[TaskService] Failed to archive submission ${submission.id}:`, err);
        }

        await this.removeReviewMessages(client, submission, services);

        return { ...submission, archived };
    }

    async updateSubmissionTier(
        client: Client,
        submissionId: string,
        tier: "bronze" | "silver" | "gold",
        reviewedBy: string,
        services: ServiceContainer
    ): Promise<(TaskSubmission & { streakLine?: string; previousTierPoints: number; previousStatus?: SubmissionStatus; archived: boolean }) | null> {
        const TIER_MAP = {
            bronze: { status: SubmissionStatus.Bronze },
            silver: { status: SubmissionStatus.Silver },
            gold: { status: SubmissionStatus.Gold },
        } as const;

        const tierInfo = TIER_MAP[tier];
        if (!tierInfo) return null;

        const submission = await this.repo.getSubmissionById(submissionId);
        if (!submission) return null;

        // Retrieve any previous submission by the same user for this task
        const previousStatus = await this.getHeldStatus(submission.userId, submission.taskEventId);
        const previousTierPoints = getStatusPoints(previousStatus);
        const nextTierPoints = getStatusPoints(tierInfo.status);
        const raised = nextTierPoints > previousTierPoints;

        // Update submission details
        submission.status = tierInfo.status;
        submission.prizeRolls = 1;
        submission.reviewedBy = reviewedBy;
        submission.reviewedAt = new Date();

        if (!submission.taskName) {
            const taskEvent = await this.repo.getTaskEventById(submission.taskEventId);
            if (taskEvent) {
                submission.taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);
            }
        }

        // Persist updates
        if (!(await this.repo.updateSubmissionStatus(submissionId, submission.status, reviewedBy))) return null;
        await this.repo.createSubmission(submission);

        let streakLine: string | undefined;
        if (raised) {
            await ensureTaskLeaderboardsInitialized(services);

            const userRepo = services.repos.userRepo;
            const prevStat = previousStatus ? TIER_STAT_MAP[previousStatus] : undefined;
            const newStat = TIER_STAT_MAP[tier];

            try {
                if (prevStat && newStat) {
                    await userRepo.updateTierStat(submission.userId, prevStat, newStat);
                } else if (newStat) {
                    await userRepo.incrementStat(submission.userId, newStat, 1);
                }
            } catch (err) {
                console.warn(`[Stats] Failed to update tier stats for ${submission.userId}:`, err);
            }

            await this.addCompletedUser(submission.taskEventId, submission.userId);

            try {
                const streakSummary = await calculateTaskStreakSummary(submission.userId, this.repo);
                streakLine = `\n🔥 Task streak: **${streakSummary.currentStreak}** (Longest: **${streakSummary.longestStreak}**).`;

                await userRepo.updateUser(submission.userId, {
                    taskStreak: streakSummary.currentStreak,
                    longestTaskStreak: streakSummary.longestStreak,
                });
            } catch (err) {
                console.warn(`[TaskService] Failed to compute streak summary for ${submission.userId}:`, err);
            }
        }

        // Notify, archive, and update counters
        try {
            await notifyUser(client, submission, streakLine, raised ? undefined : previousStatus);
        } catch (err) {
            console.warn(`[TaskService] Failed to DM user ${submission.userId} about ${submission.id}:`, err);
        }

        let archived = false;
        try {
            archived = await archiveSubmission(client, submission, services);
        } catch (err) {
            console.warn(`[TaskService] Failed to archive submission ${submission.id}:`, err);
        }

        if (raised) {
            try {
                await updateTaskCounter(client, submission.taskEventId, submission.userId, this.repo, submission.status, previousStatus);
            } catch (err) {
                console.warn(`[TaskService] Failed to update counter for event ${submission.taskEventId}:`, err);
            }
        }

        await this.removeReviewMessages(client, submission, services);

        const result = {
            ...submission,
            previousTierPoints,
            archived,
            ...(streakLine && { streakLine }),
            ...(previousStatus && { previousStatus }),
        };
        return result;
    }

    async getHeldStatus(userId: string, taskEventId: string): Promise<SubmissionStatus | undefined> {
        const approved = (await this.repo.getSubmissionsForTask(taskEventId)).filter((s) => s.userId === userId && getStatusPoints(s.status) > 0);
        return maxBy(approved, (s) => getStatusPoints(s.status))?.status;
    }


    async setPendingTask(userId: string, taskEventId: string): Promise<void> {
        await this.repo.saveSubmissionDraft({ userId, taskEventId, createdAt: new Date() });
    }

    async hasPendingTask(userId: string): Promise<boolean> {
        return (await this.repo.getSubmissionDraft(userId)) !== null;
    }

    async peekPendingTask(userId: string): Promise<string | undefined> {
        return (await this.repo.getSubmissionDraft(userId))?.taskEventId;
    }

    async consumePendingTask(userId: string): Promise<string | undefined> {
        const taskId = await this.peekPendingTask(userId);
        await this.repo.deleteSubmissionDraft(userId);
        return taskId;
    }

    private async removeReviewMessages(client: Client, submission: TaskSubmission, services: ServiceContainer): Promise<void> {
        const adminChannel = await configuredChannel(client, services, "taskVerification");
        if (!adminChannel) return;
        if (submission.message) {
            try {
                await adminChannel.messages.delete(submission.message);
            } catch (err) {
                console.warn(`[Admin Embed Cleanup Error]:`, err);
            }
        }
        if (submission.screenshotMessage) {
            try {
                await adminChannel.messages.delete(submission.screenshotMessage);
            } catch (err) {
                console.warn(`[Screenshot Message Cleanup Error]:`, err);
            }
        }
    }

    private async addCompletedUser(taskEventId: string, userId: string): Promise<void> {
        try {
            await this.repo.addCompletedUser(taskEventId, userId);
        } catch (err) {
            console.warn(`[TaskService] Failed to update completedUserIds for ${taskEventId}:`, err);
        }
    }
}
