import { sample } from "es-toolkit";
import { DateTime } from "luxon";
import type { IPrizeDrawRepository } from "../../core/database/interfaces/IPrizeDrawRepo.js";
import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo.js";
import type { PrizeDraw } from "../../models/PrizeDraw.js";
import type { TaskSubmission } from "../../models/TaskSubmission.js";
import { SubmissionStatus } from "../../models/TaskSubmission.js";
import { buildPrizeDrawEmbed } from "./TaskEmbeds.js";
import type { Client } from "discord.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../utils/MentionUtils.js";
import { configuredChannel } from "../../utils/ChannelUtils.js";
import { eventCountsForMember } from "./TaskLeaderboards.js";

const DEFAULT_PERIOD_DAYS = parseInt(process.env.PRIZE_PERIOD_DAYS ?? "14");

function getPeriodRange(endDate: Date, days: number): [Date, Date] {
    const end = DateTime.fromJSDate(endDate, { zone: "utc" }).endOf("day");
    return [end.minus({ days: days - 1 }).startOf("day").toJSDate(), end.toJSDate()];
}

function isSubmissionApprovedLike(status: SubmissionStatus): boolean {
    return (
        status === SubmissionStatus.Approved ||
        status === SubmissionStatus.Bronze ||
        status === SubmissionStatus.Silver ||
        status === SubmissionStatus.Gold
    );
}

function parseDateInput(value: string | null): Date | null {
    if (typeof value === "string") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function getMostRecentRolledDrawBeforeWindow(draws: PrizeDraw[], windowStart: Date): PrizeDraw | null {
    const candidates = draws
        .filter((draw) => !!draw.rolledAt)
        .filter((draw) => {
            const drawEnd = parseDateInput(draw.end);
            return !!drawEnd && drawEnd.getTime() < windowStart.getTime();
        })
        .sort((a, b) => {
            const aRolled = parseDateInput(a.rolledAt ?? null)?.getTime() ?? 0;
            const bRolled = parseDateInput(b.rolledAt ?? null)?.getTime() ?? 0;
            return bRolled - aRolled;
        });

    return candidates[0] ?? null;
}

async function getCarryOverSubmissions(
    prizeRepo: IPrizeDrawRepository,
    taskRepo: ITaskRepository,
    currentWindowStart: Date
): Promise<TaskSubmission[]> {
    const draws = await prizeRepo.getAllPrizeDraws();
    const previousDraw = getMostRecentRolledDrawBeforeWindow(draws, currentWindowStart);
    if (!previousDraw) return [];

    const previousDrawEnd = parseDateInput(previousDraw.end);
    const previousSnapshotTakenAt = parseDateInput(previousDraw.snapshotTakenAt);
    if (!previousDrawEnd || !previousSnapshotTakenAt) return [];

    const previousEventIds = previousDraw.taskEventIds ?? [];
    if (!previousEventIds.length) return [];

    const previousEventSubmissions = await Promise.all(
        previousEventIds.map((eventId) => taskRepo.getSubmissionsForTask(eventId))
    );

    return previousEventSubmissions
        .flat()
        .filter((submission) => isSubmissionApprovedLike(submission.status))
        .filter((submission) => {
            const { submittedAt, reviewedAt } = submission;

            if (!submittedAt || !reviewedAt) return false;

            const submittedBeforeOrAtPreviousWindowEnd = submittedAt.getTime() <= previousDrawEnd.getTime();
            const reviewedAfterPreviousSnapshot = reviewedAt.getTime() > previousSnapshotTakenAt.getTime();

            return submittedBeforeOrAtPreviousWindowEnd && reviewedAfterPreviousSnapshot;
        });
}

export async function generatePrizeDrawSnapshot(prizeRepo: IPrizeDrawRepository, taskRepo: ITaskRepository): Promise<PrizeDraw> {
    const now = new Date();
    const [start, end] = getPeriodRange(now, DEFAULT_PERIOD_DAYS);

    const qualifyingEvents = await taskRepo.getTaskEventsBetween(start, now);

    if (!qualifyingEvents.length) {
        console.warn("[PrizeDraw] No task events found in range for snapshot.");
    }

    const submissionsPerEvent = await Promise.all(
        qualifyingEvents.map((event) => taskRepo.getSubmissionsForTask(event.id))
    );

    const currentSubmissions = submissionsPerEvent.flat();
    const carryOverSubmissions = await getCarryOverSubmissions(prizeRepo, taskRepo, start);

    const filtered = [...currentSubmissions, ...carryOverSubmissions].filter((submission) =>
        isSubmissionApprovedLike(submission.status)
    );

    const STATUS_RANK: Partial<Record<SubmissionStatus, number>> = {
        [SubmissionStatus.Approved]: 1,
        [SubmissionStatus.Bronze]: 1,
        [SubmissionStatus.Silver]: 2,
        [SubmissionStatus.Gold]: 3,
    };
    const ROLLS_PER_SUBMISSION = 1;

    // Deduplicate submissions so a user only gets the highest tier per task
    const deduplicatedSubmissions = [...Map.groupBy(filtered, (submission) => `${submission.userId}-${submission.taskEventId}`).values()]
        .map((submissions) => submissions.reduce((best, submission) =>
            (STATUS_RANK[submission.status] ?? 0) >= (STATUS_RANK[best.status] ?? 0) ? submission : best
        ));
    const deduplicatedEventIds = Array.from(
        new Set(
            deduplicatedSubmissions
                .map((submission) => submission.taskEventId)
                .filter((eventId): eventId is string => typeof eventId === "string" && eventId.length > 0)
        )
    );
    const qualifyingEventIds = qualifyingEvents.map((event) => event.id);

    const events = new Map(qualifyingEvents.map((event) => [event.id, event]));
    const countedSubmissions: TaskSubmission[] = [];
    for (const submission of deduplicatedSubmissions) {
        const event = events.get(submission.taskEventId) ?? await taskRepo.getTaskEventById(submission.taskEventId);
        if (!event || await eventCountsForMember(taskRepo, event, submission.userId)) {
            countedSubmissions.push(submission);
        }
    }

    const participants: Record<string, number> = {};
    const entries: string[] = [];
    for (const submission of countedSubmissions) {
        participants[submission.userId] = (participants[submission.userId] || 0) + ROLLS_PER_SUBMISSION;
        entries.push(submission.userId);
    }

    const tierCounts = {
        bronze: countedSubmissions.filter(s => s.status === SubmissionStatus.Bronze).length,
        silver: countedSubmissions.filter(s => s.status === SubmissionStatus.Silver).length,
        gold: countedSubmissions.filter(s => s.status === SubmissionStatus.Gold).length,
    };

    const totalEntries = entries.length;

    const snapshot: PrizeDraw = {
        id: `${start.toISOString().slice(0, 10)}_to_${end.toISOString().slice(0, 10)}`,
        start: start.toISOString(),
        end: end.toISOString(),
        snapshotTakenAt: new Date().toISOString(),
        taskEventIds: Array.from(new Set([...qualifyingEventIds, ...deduplicatedEventIds])),
        participants,
        entries,
        totalEntries,
        tierCounts,
    }

    // Persist snapshot
    await prizeRepo.createPrizeDraw(snapshot);
    console.log(`[PrizeDraw] Snapshot created for ${snapshot.id}`);
    return snapshot;
}

export async function rollWinnerForSnapshot(prizeRepo: IPrizeDrawRepository, snapshotId: string, services: ServiceContainer): Promise<string | null> {
    const snapshot = await prizeRepo.getPrizeDrawById(snapshotId);

    if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found.`);
    // Check if already rolled
    if (snapshot.winnerId) return snapshot.winnerId;

    console.log("[PrizeDraw] Rolling for snapshot:", snapshot.id);
    console.log("[PrizeDraw] Participants:", snapshot.participants);
    console.log("[PrizeDraw] Total entries:", snapshot.totalEntries);

    const tickets: string[] = [];
    for (const [userId, count] of Object.entries(snapshot.participants)) {
        for (let i = 0; i < count; i++) tickets.push(userId);
    }

    if (!tickets.length) return null;
    const winnerId = sample(tickets);

    snapshot.winnerId = winnerId || "";
    snapshot.rolledAt = new Date().toISOString();

    await prizeRepo.setWinner(snapshot.id, winnerId);
    console.log(`[PrizeDraw] Winner for ${snapshotId}: ${winnerId}`);

    const userRepo = services.repos.userRepo;
    try {
        await userRepo.incrementStat(winnerId, "taskPrizesWon", 1);
        console.log(`[Stats] Incremented taskPrizesWon for ${winnerId}`);
    } catch (err) {
        console.warn(`[Stats] Failed to increment taskPrizesWon for ${winnerId}:`, err);
    }

    return winnerId;
}

export async function announcePrizeDrawWinner(
    client: Client,
    services: ServiceContainer,
    prizeRepo: IPrizeDrawRepository,
    snapshotId: string
): Promise<boolean> {
    const snapshot = await prizeRepo.getPrizeDrawById(snapshotId);
    if (!snapshot || !snapshot.winnerId) {
        console.warn(`[PrizeDraw] Cannot announce winner - snapshot or winner not found.`);
        return false;
    }

    const guildId = services.guildId;
    if (!guildId) {
        console.warn("[PrizeDraw] No guild ID available for announcement.");
        return false;
    }

    const guildConfig = await services.guilds.get(guildId);
    if (!guildConfig) {
        console.warn(`[PrizeDraw] Guild configuration missing for ${guildId}.`);
        return false;
    }

    let mention = "";
    const guild = await client.guilds.fetch(guildId);
    const guildName = guild.name;
    const suppressMentions = await isMentionSuppressed(services.guilds, guildId);
    const roleId = guildConfig.roles?.taskUser;
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    if (role) {
        mention = `<@&${role.id}>`;
    } else {
        console.warn("[PrizeDraw] Task user role not configured or not found.");
    }

    const fallbackWinner = snapshot.winnerId || "Unknown User";
    let winnerUsername = fallbackWinner;
    try {
        const winnerUser = await client.users.fetch(snapshot.winnerId);
        winnerUsername = winnerUser?.username ?? fallbackWinner;
    } catch (err) {
        console.warn(`[PrizeDraw] Failed to fetch winner username for ${snapshot.winnerId}:`, err);
    }

    // Use the count of unique task completions (deduplicated submissions)
    const totalUniqueCompletions = Object.values(snapshot.participants).reduce((sum, count) => sum + count, 0);
    
    const embedData = buildPrizeDrawEmbed(
        winnerUsername,
        totalUniqueCompletions,
        Object.keys(snapshot.participants).length,
        snapshot.start,
        snapshot.end,
        snapshot.tierCounts
    );

    const channel = await configuredChannel(client, services, "taskChannel");
    if (!channel) return false;

    await channel.send(withSuppressedMentions({ ...embedData, ...(mention ? { content: mention } : {}) }, suppressMentions));
    console.log(`[PrizeDraw] Winner embed sent to #${channel.name}`);

    // Send the winner a DM
    try {
        const winnerUser = await client.users.fetch(snapshot.winnerId);

        if (winnerUser) {
            await winnerUser.send(`**🏆 Congratulations!** You've won the latest OSRS community tasks prize draw in **${guildName}**! Please contact a **Task Admin** to claim your prize.`);

            console.log(`[PrizeDraw] DM set to winner ${winnerUser.tag}`);
        } else {
            console.warn(`[PrizeDraw] Could not fetch user for winner ID: ${snapshot.winnerId}`);
        }
    } catch (err) {
        console.warn(`[PrizeDraw] Failed to DM winner ${snapshot.winnerId}:`, err);
    }

    return true;
}
