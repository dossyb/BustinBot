import { DateTime, Duration } from "luxon";
import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import { SubmissionStatus } from "../../models/TaskSubmission.js";

export type TaskPeriod = {
    start: Date;
    end: Date;
};

export type TaskStreakSummary = {
    currentStreak: number;
    longestStreak: number;
    currentPeriod?: TaskPeriod;
    hasCompletedCurrentPeriod: boolean;
    lastCompletedPeriodEnd?: Date;
};

const APPROVED_STATUSES = new Set<SubmissionStatus>([
    SubmissionStatus.Approved,
    SubmissionStatus.Bronze,
    SubmissionStatus.Silver,
    SubmissionStatus.Gold,
]);

const PERIOD_GAP_TOLERANCE = Duration.fromObject({ hours: 6 });

function isConsecutive(prevEnd: Date, nextStart: Date): boolean {
    const gap = DateTime.fromJSDate(nextStart).diff(DateTime.fromJSDate(prevEnd));
    return gap.toMillis() >= 0 && gap <= PERIOD_GAP_TOLERANCE;
}

export async function getCurrentTaskPeriod(
    repo: ITaskRepository,
    now: Date = new Date()
): Promise<TaskPeriod | null> {
    const event = await repo.getLatestTaskEvent();
    if (!event) return null;

    if (now < event.startTime || now > event.endTime) return null;

    return {
        start: event.startTime,
        end: event.endTime,
    };
}

async function hasTaskEventsBetween(
    repo: ITaskRepository,
    start: Date,
    end: Date
): Promise<boolean> {
    if (start.getTime() > end.getTime()) return false;
    try {
        const events = await repo.getTaskEventsBetween(start, end);
        return events.length > 0;
    } catch (err) {
        console.warn(`[TaskStreaks] Failed to load task events between ${start.toISOString()} and ${end.toISOString()}:`, err);
        return false;
    }
}

function buildSummary(base: {
    currentStreak: number;
    longestStreak: number;
    hasCompletedCurrentPeriod: boolean;
}, extras?: { currentPeriod?: TaskPeriod; lastCompletedPeriodEnd?: Date; }): TaskStreakSummary {
    const summary: TaskStreakSummary = {
        currentStreak: base.currentStreak,
        longestStreak: base.longestStreak,
        hasCompletedCurrentPeriod: base.hasCompletedCurrentPeriod,
    };

    if (extras?.currentPeriod) {
        summary.currentPeriod = extras.currentPeriod;
    }

    if (extras?.lastCompletedPeriodEnd) {
        summary.lastCompletedPeriodEnd = extras.lastCompletedPeriodEnd;
    }

    return summary;
}

export async function calculateTaskStreakSummary(
    userId: string,
    repo: ITaskRepository,
    now: Date = new Date()
): Promise<TaskStreakSummary> {
    const currentPeriod = await getCurrentTaskPeriod(repo, now);

    const submissions = await repo.getSubmissionsByUser(userId);

    const approvedSubmissions = submissions.filter((submission) => APPROVED_STATUSES.has(submission.status));
    if (approvedSubmissions.length === 0) {
        return buildSummary(
            {
                currentStreak: 0,
                longestStreak: 0,
                hasCompletedCurrentPeriod: false,
            },
            currentPeriod ? { currentPeriod } : undefined
        );
    }

    const eventIds = Array.from(new Set(approvedSubmissions.map((submission) => submission.taskEventId)));
    const events = await Promise.all(eventIds.map((eventId) => repo.getTaskEventById(eventId)));
    const eventMap = new Map<string, TaskEvent>();

    events.forEach((event, index) => {
        const eventId = eventIds[index];
        if (!event || !eventId) return;
        eventMap.set(eventId, event);
    });

    const periodMap = new Map<number, TaskPeriod>();

    for (const submission of approvedSubmissions) {
        const event = eventMap.get(submission.taskEventId);
        if (!event) continue;

        const submittedAt = submission.submittedAt ?? submission.createdAt;
        if (submittedAt.getTime() > event.endTime.getTime()) continue;

        const period = periodMap.getOrInsertComputed(event.endTime.getTime(), () => ({
            start: event.startTime,
            end: event.endTime,
        }));
        if (event.startTime < period.start) period.start = event.startTime;
        if (event.endTime > period.end) period.end = event.endTime;
    }

    const periods = Array.from(periodMap.values()).sort(
        (a, b) => a.end.getTime() - b.end.getTime()
    );

    if (periods.length === 0) {
        return buildSummary(
            {
                currentStreak: 0,
                longestStreak: 0,
                hasCompletedCurrentPeriod: false,
            },
            currentPeriod ? { currentPeriod } : undefined
        );
    }

    const runLengthByEnd = new Map<number, number>();
    let longest = 0;
    let run = 0;

    for (const [i, period] of periods.entries()) {
        const previous = i > 0 ? periods[i - 1] : null;

        if (previous) {
            const gapStart = DateTime.fromJSDate(previous.end).plus({ milliseconds: 1 }).toJSDate();
            const hasGapEvents = await hasTaskEventsBetween(repo, gapStart, period.start);
            const shouldContinue = isConsecutive(previous.end, period.start) || !hasGapEvents;
            run = shouldContinue ? run + 1 : 1;
        } else {
            run = 1;
        }

        runLengthByEnd.set(period.end.getTime(), run);
        if (run > longest) longest = run;
    }

    const lastCompleted = periods.at(-1);
    if (!lastCompleted) {
        return buildSummary(
            {
                currentStreak: 0,
                longestStreak: 0,
                hasCompletedCurrentPeriod: false,
            },
            currentPeriod ? { currentPeriod } : undefined
        );
    }

    let currentStreak = 0;
    let hasCompletedCurrentPeriod = false;

    if (currentPeriod) {
        const currentKey = currentPeriod.end.getTime();
        const currentRun = runLengthByEnd.get(currentKey);

        if (currentRun !== undefined) {
            currentStreak = currentRun;
            hasCompletedCurrentPeriod = true;
        } else {
            const gapStart = DateTime.fromJSDate(lastCompleted.end).plus({ milliseconds: 1 }).toJSDate();
            const hasGapEvents = await hasTaskEventsBetween(repo, gapStart, currentPeriod.start);
            if (isConsecutive(lastCompleted.end, currentPeriod.start) || !hasGapEvents) {
                currentStreak = runLengthByEnd.get(lastCompleted.end.getTime()) ?? 0;
            } else {
                currentStreak = 0;
            }
        }
    } else {
        currentStreak = runLengthByEnd.get(lastCompleted.end.getTime()) ?? 0;
    }

    return buildSummary(
        {
            currentStreak,
            longestStreak: longest,
            hasCompletedCurrentPeriod,
        },
        {
            ...(currentPeriod ? { currentPeriod } : {}),
            lastCompletedPeriodEnd: lastCompleted.end,
        }
    );
}
