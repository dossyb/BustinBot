import type { IPrizeDrawRepository } from '../../core/database/interfaces/IPrizeDrawRepo';
import type { ITaskRepository } from '../../core/database/interfaces/ITaskRepo';
import type { PrizeDraw } from '../../models/PrizeDraw';
import type { TaskEvent } from '../../models/TaskEvent';
import { TaskCategory } from '../../models/Task';
import { SubmissionStatus } from '../../models/TaskSubmission';
import { buildPrizeDrawEmbed } from './TaskEmbeds';
import { Client, TextChannel } from 'discord.js';
import { isTextChannel } from '../../utils/ChannelUtils';

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
        (s) => s.status === SubmissionStatus.Approved
    );

    const participants: Record<string, number> = {};
    for (const submission of filtered) {
        participants[submission.userId] = (participants[submission.userId] || 0) + 1;
    }

    const snapshot: PrizeDraw = {
        id: `${start.toISOString().slice(0, 10)}_to_${end.toISOString().slice(0, 10)}`,
        start: start.toISOString(),
        end: end.toISOString(),
        snapshotTakenAt: new Date().toISOString(),
        taskEventIds: Array.from(new Set(qualifyingEvents.map(event => event.id))),
        participants,
        entries: filtered.map((submission) => submission.userId),
        totalEntries: filtered.length
    }

    // Persist snapshot
    await prizeRepo.createPrizeDraw(snapshot);
    console.log(`[PrizeDraw] Snapshot created for ${snapshot.id}`);
    return snapshot;
}

export async function rollWinnerForSnapshot(prizeRepo: IPrizeDrawRepository, snapshotId: string): Promise<string | null> {
    const snapshot = await prizeRepo.getPrizeDrawById(snapshotId);

    if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found.`);
    // Check if already rolled
    if (snapshot.winnerId) return snapshot.winnerId;

    console.log('[DEBUG] Rolling for snapshot:', snapshot.id);
    console.log('[DEBUG] Participants:', snapshot.participants);
    console.log('[DEBUG] Total entries:', snapshot.totalEntries);

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

    return winnerId;
}

export async function announcePrizeDrawWinner(client: Client, prizeRepo: IPrizeDrawRepository, snapshotId: string): Promise<boolean> {
    const snapshot = await prizeRepo.getPrizeDrawById(snapshotId);
    if (!snapshot || !snapshot.winnerId) {
        console.warn(`[PrizeDraw] Cannot announce winner - snapshot or winner not found.`);
        return false;
    }

    const guildId = process.env.DISCORD_GUILD_ID;
    const roleName = process.env.TASK_USER_ROLE_NAME;

    let mention = '';
    if (guildId && roleName) {
        const guild = await client.guilds.fetch(guildId);
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (role) {
            mention = `<@&${role.id}>`;
        } else {
            console.warn(`[PrizeDraw] Could not find role named "${roleName}". Proceeding without mention.`);
        }
    }

    const embedData = buildPrizeDrawEmbed(
        snapshot.winnerId,
        snapshot.totalEntries,
        Object.keys(snapshot.participants).length,
        snapshot.start,
        snapshot.end
    );

    const channel = client.channels.cache.find(
        (c): c is TextChannel => isTextChannel(c) && "name" in c && c.name === 'weekly-task'
    );

    if (!channel) {
        console.warn(`[PrizeDraw] Announcement channel not found.`);
        return false;
    }

    await channel.send(`${mention}`);
    await channel.send({ ...embedData });
    console.log(`[PrizeDraw] Winner embed sent to #${channel.name}`);
    return true;
}