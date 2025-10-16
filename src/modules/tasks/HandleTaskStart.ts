import { Client, TextChannel } from 'discord.js';
import { buildTaskEventEmbed } from './TaskEmbeds';
import type { TaskEvent } from '../../models/TaskEvent';
import type { ServiceContainer } from '../../core/services/ServiceContainer';


function generateTaskEventId(taskId: string): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${taskId}-${yyyy}${mm}${dd}`;
}

export async function startTaskEvent(client: Client, services: ServiceContainer): Promise<void> {
    const { repos, taskEvents, keywords } = services;

    if (!repos?.taskRepo || !taskEvents || !keywords) {
        console.error(
            "[TaskStart] Missing required dependencies: taskRepo, taskEvents, or keywords."
        );
        return;
    }

    const guildId = process.env.DISCORD_GUILD_ID;
    const channelId = process.env.TASK_CHANNEL_ID;
    if (!guildId || !channelId) return;

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const roleName = process.env.TASK_USER_ROLE_NAME;
    const role = guild.roles.cache.find(r => r.name === roleName);

    const pollData = await repos.taskRepo.getActiveTaskPoll();
    if (!pollData || !pollData.options?.length) {
        console.warn('[TaskStart] No active poll found or poll data invalid.');
        return;
    }

    // Tally votes per option ID
    const voteCounts: Record<string, number> = {};
    for (const votedTaskId of Object.values(pollData.votes)) {
        voteCounts[votedTaskId] = (voteCounts[votedTaskId] ?? 0) + 1;
    }

    // Pick the task option with the highest vote count
    const winningTask = pollData.options.reduce((a, b) => {
        const votesA = voteCounts[a.id] ?? 0;
        const votesB = voteCounts[b.id] ?? 0;
        return votesA >= votesB ? a : b;
    });

    // Load full task data
    const task = await repos.taskRepo.getTaskById(winningTask.id);
    if (!task) {
        console.error(`[TaskStart] Could not find task with id ${winningTask.id}`);
        return;
    }

    const selectedAmount = task.amounts?.[0] ?? 0;
    const taskEventId = generateTaskEventId(task.id);

    const event: TaskEvent = {
        id: taskEventId,
        task,
        keyword: await keywords.selectKeyword(taskEventId),
        startTime: new Date(),
        endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
        selectedAmount,
        createdAt: new Date(),
    };

    const { embeds, components } = buildTaskEventEmbed(event);

    const mention = role ? `<@&${role.id}>` : '';
    if (!role) {
        console.warn(`[TaskStart] Could not find role "${roleName}". Proceeding without mention.`);
    }

    await channel.send(`${mention}`);
    await (channel as TextChannel).send({ embeds, components });

    console.log(`[TaskStart] Task event posted for task ID ${taskEventId}`);

    await taskEvents.storeTaskEvent(event);
    if (pollData.id) {
        await repos.taskRepo.closeTaskPoll(pollData.id);
    }
}