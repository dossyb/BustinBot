import type { IPrizeDrawRepository } from '../../core/database/interfaces/IPrizeDrawRepo.js';
import type { ITaskRepository } from '../../core/database/interfaces/ITaskRepo.js';
import type { PrizeDraw } from '../../models/PrizeDraw.js';
import type { TaskEvent } from '../../models/TaskEvent.js';
import { TaskCategory } from '../../models/Task.js';
import { SubmissionStatus } from '../../models/TaskSubmission.js';
import { buildPrizeDrawEmbed } from './TaskEmbeds.js';
import { Client, TextChannel } from 'discord.js';
import { isTextChannel } from '../../utils/ChannelUtils.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import fs from 'fs';
import path from 'path';

const DEFAULT_PERIOD_DAYS = parseInt(process.env.PRIZE_PERIOD_DAYS ?? '14');

function getPeriodRange(endDate: Date, days: number): [Date, Date] {
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - days + 1);
    start.setUTCHours(0, 0, 0, 0);
    return [start, end];
}

export async function generatePrizeDrawSnapshot(prizeRepo: IPrizeDrawRepository, taskRepo: ITaskRepository): Promise<PrizeDraw> {
    const now = new Date();
    const [start, end] = getPeriodRange(now, DEFAULT_PERIOD_DAYS);

    const qualifyingEvents: TaskEvent[] = await taskRepo.getTaskEventsBetween(start, end);

    if (!qualifyingEvents.length) {
        console.warn('[PrizeDraw] No task events found in range for snapshot.');
    }

    const submissionsPerEvent = await Promise.all(
        qualifyingEvents.map((event) => taskRepo.getSubmissionsForTask(event.id))
    );

    const allSubmissions = submissionsPerEvent.flat();

    const filtered = allSubmissions.filter(
        (s) =>
            s.status === SubmissionStatus.Approved ||
            s.status === SubmissionStatus.Bronze ||
            s.status === SubmissionStatus.Silver ||
            s.status === SubmissionStatus.Gold
    );

    const participants: Record<string, number> = {};
    for (const submission of filtered) {
        participants[submission.userId] = (participants[submission.userId] || 0) + 1;
    }

    const tierCounts = {
        bronze: filtered.filter(s => s.status === SubmissionStatus.Bronze).length,
        silver: filtered.filter(s => s.status === SubmissionStatus.Silver).length,
        gold: filtered.filter(s => s.status === SubmissionStatus.Gold).length,
    };

    const snapshot: PrizeDraw = {
        id: `${start.toISOString().slice(0, 10)}_to_${end.toISOString().slice(0, 10)}`,
        start: start.toISOString(),
        end: end.toISOString(),
        snapshotTakenAt: new Date().toISOString(),
        taskEventIds: Array.from(new Set(qualifyingEvents.map(event => event.id))),
        participants,
        entries: filtered.map((submission) => submission.userId),
        totalEntries: filtered.length,
        tierCounts,
    }

    // TEMP: Remove after first draw
    // Inlcude final v1 task completions in first prize draw
    const nowISO = new Date().toISOString();

    const firstDrawCutoff = new Date("2025-11-12T00:00:00Z");
    if (nowISO < firstDrawCutoff.toISOString()) {
        try {
            const carryoverPath = path.resolve(process.cwd(), "data/legacy-finaldraw.json");
            const fileContents = fs.readFileSync(carryoverPath, 'utf8');
            const { users: v1Users } = JSON.parse(fileContents) as { users: Array<{ id: string; submissions: number }> };

            console.log(`[PrizeDraw] Merging ${v1Users.length} carryover submissions from v1...`);

            for (const { id, submissions } of v1Users) {
                snapshot.participants[id] = (snapshot.participants[id] || 0) + submissions;

                for (let i = 0; i < submissions; i++) snapshot.entries.push(id);
                snapshot.totalEntries += submissions;
            }

            console.log("[PrizeDraw] Carryover merge complete. Total entries now:", snapshot.totalEntries);
        } catch (err) {
            console.warn("[PrizeDraw] Failed to merge v1 submissions:", err);
        }
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

    console.log('[PrizeDraw] Rolling for snapshot:', snapshot.id);
    console.log('[PrizeDraw] Participants:', snapshot.participants);
    console.log('[PrizeDraw] Total entries:', snapshot.totalEntries);

    const tickets: string[] = [];
    for (const [userId, count] of Object.entries(snapshot.participants)) {
        for (let i = 0; i < count; i++) tickets.push(userId);
    }

    if (tickets.length === 0) return null;

    const winnerId = tickets[Math.floor(Math.random() * tickets.length)]!;
    snapshot.winnerId = winnerId || '';
    snapshot.rolledAt = new Date().toISOString();

    await prizeRepo.setWinners(snapshot.id, {} as Record<TaskCategory, string[]>, winnerId);
    console.log(`[PrizeDraw] Winner for ${snapshotId}: ${winnerId}`);

    const userRepo = services.repos.userRepo;
    if (userRepo && winnerId) {
        try {
            await userRepo.incrementStat(winnerId, "taskPrizesWon", 1);
            console.log(`[Stats] Incremented taskPrizesWon for ${winnerId}`);
        } catch (err) {
            console.warn(`[Stats] Failed to increment taskPrizesWon for ${winnerId}:`, err);
        }
    } else {
        console.warn("[Stats] UserRepo unavailable or winnerId missing; skipping taskPrizesWon increment.");
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
        console.warn('[PrizeDraw] No guild ID available for announcement.');
        return false;
    }

    const guildConfig = await services.guilds.get(guildId);
    if (!guildConfig) {
        console.warn(`[PrizeDraw] Guild configuration missing for ${guildId}.`);
        return false;
    }

    let mention = '';
    const guild = await client.guilds.fetch(guildId);
    const guildName = guild.name;
    const roleId = guildConfig.roles?.taskUser;
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    if (role) {
        mention = `<@&${role.id}>`;
    } else {
        console.warn('[PrizeDraw] Task user role not configured or not found.');
    }

    const embedData = buildPrizeDrawEmbed(
        snapshot.winnerId,
        snapshot.totalEntries,
        Object.keys(snapshot.participants).length,
        snapshot.start,
        snapshot.end,
        snapshot.tierCounts
    );

    let channel: TextChannel | undefined;
    const taskChannelId = guildConfig.channels?.taskChannel;
    if (taskChannelId) {
        const fetched = await guild.channels.fetch(taskChannelId);
        if (fetched && isTextChannel(fetched)) {
            channel = fetched;
        }
    }

    if (!channel) {
        channel = client.channels.cache.find(
            (c): c is TextChannel => isTextChannel(c) && "name" in c && c.name === 'weekly-task'
        );
    }

    if (!channel) {
        console.warn(`[PrizeDraw] Announcement channel not found.`);
        return false;
    }

    await channel.send(`${mention}`);
    await channel.send({ ...embedData });
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
