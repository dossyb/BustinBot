import { Client, TextChannel } from 'discord.js';
import { buildTaskEventEmbed } from './TaskEmbeds.js';
import type { TaskEvent } from '../../models/TaskEvent.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { TaskCategory } from '../../models/Task.js';

function generateTaskEventId(taskId: string): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${taskId}-${yyyy}${mm}${dd}`;
}

export async function startAllTaskEvents(client: Client, services: ServiceContainer): Promise<void> {
    const { keywords, repos } = services;
    if (!keywords) {
        console.error('[TaskStart] Missing keywords service.');
        return;
    }

    const guildId = services.guildId;
    if (!guildId) {
        console.warn('[TaskStart] No guild ID available in services.');
        return;
    }
    const guildConfig = await services.guilds.get(guildId);
    if (!guildConfig) {
        console.warn(`[TaskStart] Guild configuration not found for ${guildId}.`);
        return;
    }
    const leaguesEnabled = guildConfig?.toggles?.leaguesEnabled ?? false;

    const categories: TaskCategory[] = [
        TaskCategory.PvM,
        TaskCategory.Skilling,
        TaskCategory.MinigameMisc
    ];

    if (leaguesEnabled) categories.push(TaskCategory.Leagues);

    const sharedKeyword = await keywords.selectKeyword(`weekly-${Date.now()}`);

    const channelId = guildConfig.channels?.taskChannel;
    if (!channelId) {
        console.warn('[TaskStart] Task channel not configured.');
        return;
    }

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
        console.warn('[TaskStart] Configured task channel is not text-based.');
        return;
    }

    const roleId = guildConfig.roles?.taskUser;
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    const mention = role ? `<@&${role.id}>` : '';

    if (!role) {
        console.warn(`[TaskStart] Task user role not configured or not found.`);
    }

    await channel.send(
        `${mention} **The new tasks are live!**\n` +
        `Include the keyword **${sharedKeyword}** in your screenshots for verification 🔑`
    );

    for (const category of categories) {
        await startTaskEventForCategory(client, services, category, sharedKeyword, channel as TextChannel);
    }
}

export async function startTaskEventForCategory(
    client: Client,
    services: ServiceContainer,
    category: TaskCategory,
    sharedKeyword: string,
    channelOverride?: TextChannel
): Promise<void> {
    const { repos, taskEvents } = services;

    if (!repos?.taskRepo || !taskEvents) {
        console.error(
            "[TaskStart] Missing required dependencies: taskRepo or taskEvents."
        );
        return;
    }

    const guildId = services.guildId;
    if (!guildId) {
        console.warn('[TaskStart] No guild ID available while starting category event.');
        return;
    }

    const guildConfig = await services.guilds.get(guildId);
    if (!guildConfig) {
        console.warn(`[TaskStart] Guild configuration missing for ${guildId}.`);
        return;
    }

    let channel = channelOverride as TextChannel | undefined;
    if (!channel) {
        const channelId = guildConfig.channels?.taskChannel;
        if (!channelId) {
            console.warn('[TaskStart] Task channel not configured.');
            return;
        }
        const guild = await client.guilds.fetch(guildId);
        const fetchedChannel = await guild.channels.fetch(channelId);
        if (!fetchedChannel?.isTextBased()) {
            console.warn('[TaskStart] Configured task channel is not text-based.');
            return;
        }
        channel = fetchedChannel as TextChannel;
    }

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

    const maxVotes = Math.max(...pollData.options.map(opt => voteCounts[opt.id] ?? 0));
    const topTasks = pollData.options.filter(opt => (voteCounts[opt.id] ?? 0) === maxVotes);

    // Deterministically select winner; fall back to first in poll order for ties
    const winningTask = topTasks[0];
    if (!winningTask) return;

    const winnerLabel = winningTask.taskName ?? winningTask.id;
    if (topTasks.length > 1) {
        console.log(`[TaskStart] Tie detected in ${category}: ${topTasks.length} tasks tied with ${maxVotes} votes. Selected winner by poll order: ${winnerLabel}`);
    } else {
        console.log(`[TaskStart] Winner for ${category}: ${winnerLabel} (${maxVotes} votes)`);
    }

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
        completionCounts: {
            bronze: 0,
            silver: 0,
            gold: 0
        },
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
