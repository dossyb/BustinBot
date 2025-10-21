import { Client, TextChannel } from 'discord.js';
import { buildTaskEventEmbed } from './TaskEmbeds';
import type { TaskEvent } from '../../models/TaskEvent';
import type { ServiceContainer } from '../../core/services/ServiceContainer';
import { TaskCategory } from 'models/Task';

function generateTaskEventId(taskId: string): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${taskId}-${yyyy}${mm}${dd}`;
}

export async function startAllTaskEvents(client: Client, services: ServiceContainer, leaguesEnabled = false): Promise<void> {
    const { keywords } = services;
    if (!keywords) {
        console.error('[TaskStart] Missing keywords service.');
        return;
    }

    const categories: TaskCategory[] = [
        TaskCategory.PvM,
        TaskCategory.Skilling,
        TaskCategory.MinigameMisc
    ];

    if (leaguesEnabled) categories.push(TaskCategory.Leagues);

    const sharedKeyword = await keywords.selectKeyword(`weekly-${Date.now()}`);

    const guildId = process.env.DISCORD_GUILD_ID;
    const channelId = process.env.TASK_CHANNEL_ID;
    if (!guildId || !channelId) return;

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const roleName = process.env.TASK_USER_ROLE_NAME;
    const role = guild.roles.cache.find(r => r.name === roleName);
    const mention = role ? `<@&${role.id}>` : '';

    if (!role) {
        console.warn(`[TaskStart] Could not find role "${roleName}". Proceeding without mention.`);
    }

    await channel.send(
        `${mention} **The new tasks are live!**\n` +
        `Include the keyword **${sharedKeyword}** in your screenshots for verification 🔑`
    );

    for (const category of categories) {
        await startTaskEventForCategory(client, services, category, sharedKeyword);
    }
}

export async function startTaskEventForCategory(client: Client, services: ServiceContainer, category: TaskCategory, sharedKeyword: string): Promise<void> {
    const { repos, taskEvents } = services;

    if (!repos?.taskRepo || !taskEvents) {
        console.error(
            "[TaskStart] Missing required dependencies: taskRepo or taskEvents."
        );
        return;
    }

    const guildId = process.env.DISCORD_GUILD_ID;
    const channelId = process.env.TASK_CHANNEL_ID;
    if (!guildId || !channelId) return;

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const pollData =
        (await repos.taskRepo.getActiveTaskPollByCategory(category)) ??
        (await repos.taskRepo.getLatestTaskPollByCategory(category));

    if (!pollData || !pollData.options?.length) {
        console.warn(`[TaskStart] No active poll found for ${category}.`);
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

    const taskEventId = generateTaskEventId(task.id);

    const event: TaskEvent = {
        id: taskEventId,
        task,
        category,
        keyword: sharedKeyword,
        startTime: new Date(),
        endTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
        amounts: {
            bronze: task.amtBronze,
            silver: task.amtSilver,
            gold: task.amtGold,
        },
        completionCount: 0,
        completedUserIds: [],
        createdAt: new Date(),
    };

    const { embeds, components, files } = buildTaskEventEmbed(event);

    const sentMessage = await (channel as TextChannel).send({ embeds, components, files });

    event.messageId = sentMessage.id;
    event.channelId = (channel as TextChannel).id;

    await taskEvents.storeTaskEvent(event);
    
    if (pollData.id) {
        await repos.taskRepo.closeTaskPoll(pollData.id);
    }

    console.log(`[TaskStart] Task event posted for ${category} (${taskEventId})`);
}