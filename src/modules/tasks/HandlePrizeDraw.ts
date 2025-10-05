import type { PrizeDraw } from '../../models/PrizeDraw';
import type { TaskEvent } from '../../models/TaskEvent';
import fs from 'fs';
import path from 'path';
import type { TaskSubmission } from '../../models/TaskSubmission';
import { SubmissionStatus } from '../../models/TaskSubmission';
import { buildPrizeDrawEmbed } from './TaskEmbeds';
import { Client, TextChannel } from 'discord.js';
import { isTextChannel } from '../../utils/ChannelUtils';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const submissionsPath = resolve(__dirname, '../../data/submissions.json');
const drawsPath = resolve(__dirname, '../../data/prizeDraws.json');
const eventsPath = resolve(__dirname, '../../data/taskEvents.json');

const DEFAULT_PERIOD_DAYS = parseInt(process.env.PRIZE_PERIOD_DAYS ?? '14');

function getPeriodRange(endDate: Date, days: number): [Date, Date] {
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - days + 1);
    start.setUTCHours(0, 0, 0, 0);
    return [start, end];
}

export function generatePrizeDrawSnapshot(): PrizeDraw {
    const allSubmissions: TaskSubmission[] = fs.existsSync(submissionsPath)
        ? JSON.parse(fs.readFileSync(submissionsPath, 'utf-8'))
        : [];

    const allEvents: TaskEvent[] = fs.existsSync(eventsPath)
        ? JSON.parse(fs.readFileSync(eventsPath, 'utf-8'))
        : [];

    const now = new Date();
    const [start, end] = getPeriodRange(now, DEFAULT_PERIOD_DAYS);

    const qualifyingEvents = allEvents.filter(e => {
        const eventStart = new Date(e.startTime);
        return eventStart >= start && eventStart <= end;
    });

    const includedEventIds = new Set(qualifyingEvents.map(e => e.taskEventId));

    const filtered = allSubmissions.filter((s) =>
        s.status === SubmissionStatus.Approved &&
        includedEventIds.has(s.taskEventId)
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
        participants,
        totalEntries: filtered.length
    }

    // Persist snapshot
    let allDraws: PrizeDraw[] = [];
    if (fs.existsSync(drawsPath)) {
        allDraws = JSON.parse(fs.readFileSync(drawsPath, 'utf-8'));
    }
    // Remove older snapshots with same ID
    const updatedDraws = allDraws.filter(d => d.id !== snapshot.id);
    updatedDraws.push(snapshot);
    fs.writeFileSync(drawsPath, JSON.stringify(updatedDraws, null, 2));

    console.log(`[PrizeDraw] Snapshot created for ${snapshot.id}`);
    return snapshot;
}

export function rollWinnerForSnapshot(snapshotId: string): string | null {
    const allDraws: PrizeDraw[] = JSON.parse(fs.readFileSync(drawsPath, 'utf-8'));
    const snapshot = allDraws
        .filter(d => d.id === snapshotId)
        .sort((a, b) => new Date(b.snapshotTakenAt).getTime() - new Date(a.snapshotTakenAt).getTime())[0];

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

    fs.writeFileSync(drawsPath, JSON.stringify(allDraws, null, 2));
    console.log(`[PrizeDraw] Winner for ${snapshotId}: ${winnerId}`);

    return winnerId;
}

export async function announcePrizeDrawWinner(client: Client, snapshotId: string) {
    const allDraws: PrizeDraw[] = fs.existsSync(drawsPath)
        ? JSON.parse(fs.readFileSync(drawsPath, 'utf-8'))
        : [];

    const snapshot = allDraws.find(d => d.id === snapshotId);
    if (!snapshot || !snapshot.winnerId) {
        console.warn(`[PrizeDraw] Cannot announce winner - snapshot or winner not found.`);
        return;
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

    const embed = buildPrizeDrawEmbed(
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
        return;
    }

    await channel.send(`${mention}`);
    await channel.send({ embeds: [embed] });
    console.log(`[PrizeDraw] Winner embed sent to #${channel.name}`);
}