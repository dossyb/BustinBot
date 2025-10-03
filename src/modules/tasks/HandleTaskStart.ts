import { Client, TextChannel } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { buildTaskEventEmbed } from './TaskEmbeds';
import type { Task } from '../../models/Task';
import type { TaskEvent } from '../../models/TaskEvent';
import { storeTaskEvent } from './TaskEventStore';

const pollPath = path.resolve(process.cwd(), 'src/data/activePoll.json');
const taskPath = path.resolve(process.cwd(), 'src/data/tasks.json');

function generateTaskEventId(taskId: number): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${taskId}-${yyyy}${mm}${dd}`;
}

export async function startTaskEvent(client: Client): Promise<void> {
    const guildId = process.env.DISCORD_GUILD_ID;
    const channelId = process.env.TASK_CHANNEL_ID;
    if (!guildId || !channelId) return;

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    // Load and validate poll data
    if (!fs.existsSync(pollPath)) {
        console.warn('[TaskStart] No active poll data found. Skipping task event.');
        return;
    }

    const pollData = JSON.parse(fs.readFileSync(pollPath, 'utf8'));
    if (!pollData?.tasks?.length) {
        console.warn('[TaskStart] Poll data invalid or missing tasks.');
        return;
    }

    // Determine winning task (highest votes)
    const winning = pollData.tasks.reduce((a: any, b: any) => a.votes > b.votes ? a : b);

    // Load full task data
    const allTasks: Task[] = JSON.parse(fs.readFileSync(taskPath, 'utf8'));
    const task = allTasks.find(t => t.id === winning.id);
    if (!task) {
        console.error(`[TaskStart] Could not find task with id ${winning.id}`);
        return;
    }

    const selectedAmount = task.amounts?.[0];
    const taskEventId = generateTaskEventId(task.id);

    const baseEvent = {
        taskEventId,
        task,
        keyword: 'pineapple', // TODO: Replace with random keyword logic
        startTime: new Date(),
        endTime: new Date(Date.now() + 7 * 60 * 1000) // Testing interval
    };

    const event: TaskEvent = selectedAmount !== undefined
        ? { ...baseEvent, selectedAmount }
        : baseEvent;

    const { embeds, components } = buildTaskEventEmbed(event);
    await (channel as TextChannel).send({ embeds, components });

    console.log(`[TaskStart] Task event posted for task ID ${taskEventId}`);
    storeTaskEvent(event);
}