import { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, Client, ButtonInteraction, ComponentType } from 'discord.js';
import type { Task } from '../../models/Task.js';
import type { TaskPoll } from '../../models/TaskPoll.js';
import { TaskCategory } from '../../models/Task.js';
import { selectTasksForCategory } from './TaskSelector.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { buildTaskPollEmbed, getTaskPollIconFile } from './TaskEmbeds.js';
import { isMentionSuppressed, withSuppressedMentions } from '../../utils/MentionUtils.js';

const activeVotes = new Map<string, Map<string, number>>(); // messageId -> Map<taskId, voteCount>
const activePollSelections = new Map<string, Task[]>(); // messageId -> Task options list
const emojiNumbers = ['1️⃣', '2️⃣', '3️⃣'];
const PROD_TASK_POLL_DURATION_MS = 24 * 60 * 60 * 1000;
const DEV_TASK_POLL_DURATION_MS = 5 * 60 * 1000;

function getTaskPollDurationMs(): number {
    return process.env.BOT_MODE === 'dev' ? DEV_TASK_POLL_DURATION_MS : PROD_TASK_POLL_DURATION_MS;
}

export function hasActiveTaskPollCollector(messageId: string): boolean {
    return activeVotes.has(messageId);
}

export async function handleTaskPollVoteInteraction(
    interaction: ButtonInteraction,
    services: ServiceContainer
) {
    await interaction.deferReply({ flags: 1 << 6 });

    const [, categoryRaw, voteId] = interaction.customId.split('_');
    const category = categoryRaw as TaskCategory | undefined;
    if (!category || !voteId) {
        await interaction.reply({ content: "Invalid poll vote option.", flags: 1 << 6 });
        return;
    }

    const taskRepo = services.repos.taskRepo;
    if (!taskRepo) {
        await interaction.reply({ content: "Task repository unavailable.", flags: 1 << 6 });
        return;
    }

    const poll = await taskRepo.getTaskPollById(interaction.message.id);
    if (!poll?.isActive) {
        await interaction.editReply({ content: "This poll is no longer active." });
        return;
    }

    if ((poll.category as TaskCategory | undefined) !== category) {
        await interaction.editReply({ content: "This poll message is outdated." });
        return;
    }

    if (poll.messageId !== interaction.message.id) {
        await interaction.editReply({ content: "This poll message is outdated." });
        return;
    }

    if (!poll.options.some((option) => option.id === voteId)) {
        await interaction.editReply({ content: "Invalid vote option." });
        return;
    }

    let firstTime = false;
    let updatedPoll = poll;
    try {
        const result = await taskRepo.voteInPollOnce(poll.id, interaction.user.id, voteId);
        firstTime = result.firstTime;
        updatedPoll = result.updatedPoll;
    } catch (err) {
        console.error("[TaskPoll] Failed to record vote transaction:", err);
        await interaction.editReply({ content: "An error occurred while recording your vote." });
        return;
    }

    if (firstTime) {
        const userRepo = services.repos.userRepo;
        if (userRepo) {
            try {
                await userRepo.incrementStat(interaction.user.id, "taskPollsVoted", 1);
            } catch (err) {
                console.warn(`[Stats] Failed to increment taskPollsVoted for ${interaction.user.username}:`, err);
            }
        } else {
            console.warn("[Stats] UserRepo unavailable; skipping taskPollsVoted increment.");
        }
    }

    await refreshTaskPollMessage(interaction.client, updatedPoll);
    await interaction.editReply({ content: "Thank you for your vote!" });
}

export async function postAllTaskPolls(client: Client, services: ServiceContainer) {
    const { repos } = services;
    const guildId = services.guildId;
    if (!guildId) {
        console.warn('[TaskPoll] No guild ID available in services.');
        return;
    }
    const guildConfig = await services.guilds.get(guildId);
    if (!guildConfig) {
        console.warn(`[TaskPoll] Guild configuration missing for ${guildId}.`);
        return;
    }

    const leaguesEnabled = guildConfig?.toggles?.leaguesEnabled ?? false;

    const categories: TaskCategory[] = [
        TaskCategory.PvM,
        TaskCategory.Skilling,
        TaskCategory.MinigameMisc,
    ];

    if (leaguesEnabled) {
        categories.push(TaskCategory.Leagues);
    }

    const channelId = guildConfig.channels?.taskChannel;
    if (!channelId) {
        console.warn('[TaskPoll] Task channel not configured.');
        return;
    }

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
        console.warn('[TaskPoll] Configured task channel is not text-based.');
        return;
    }

    const roleId = guildConfig.roles?.taskUser;
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    const suppressMentions = await isMentionSuppressed(services.guilds, guildId);

    const mention = role ? `<@&${role.id}>` : '';
    if (!role) {
        console.warn(`[TaskPoll] Task user role not configured or not found.`);
    }
    await (channel as TextChannel).send(
        withSuppressedMentions(
            { content: `${mention} **New task polls are live!** Cast your votes for each category below:` },
            suppressMentions
        )
    );

    for (const category of categories) {
        await postTaskPollForCategory(client, services, category, channel as TextChannel);
    }
}

export async function postTaskPollForCategory(
    client: Client,
    services: ServiceContainer,
    category: TaskCategory,
    channelOverride?: TextChannel
) {
    const userVotes = new Map<string, string>(); // userId -> taskId

    const guildId = services.guildId;
    if (!guildId) {
        console.warn('[TaskPoll] No guild ID available while posting category poll.');
        return;
    }

    const guildConfig = await services.guilds.get(guildId);
    if (!guildConfig) {
        console.warn(`[TaskPoll] Guild configuration missing for ${guildId}.`);
        return;
    }

    let channel = channelOverride as TextChannel | undefined;
    let channelId = '';
    if (!channel) {
        channelId = guildConfig.channels?.taskChannel ?? '';
        if (!channelId) {
            console.warn('[TaskPoll] Task channel not configured.');
            return;
        }

        const guild = await client.guilds.fetch(guildId);
        const fetchedChannel = await guild.channels.fetch(channelId);
        if (!fetchedChannel?.isTextBased()) {
            console.warn('[TaskPoll] Configured task channel is not text-based.');
            return;
        }

        channel = fetchedChannel as TextChannel;
    }
    channelId = channelId || channel.id;

    const repo = services.repos.taskRepo;
    if (!repo) return;

    const allTasks: Task[] = await repo.getAllTasks();
    const taskData = allTasks.filter(t => t.category === category);
    if (taskData.length < 3) {
        console.warn(`[TaskPoll] Not enough tasks to create a poll for category ${category}`);
        return;
    }

    const selectedTasks = selectTasksForCategory(category, allTasks);
    if (selectedTasks.length === 0) {
        console.warn(`[TaskPoll] No tasks selected for ${category}.`);
        return;
    }

    const taskVotes = new Map<string, number>();
    const taskButtons = selectedTasks.map((task, i) => {
        const taskId = task.id.toString();
        taskVotes.set(taskId, 0);

        const label = `${emojiNumbers[i]} ${task.shortName ?? `Task ${i + 1}`}`;

        return new ButtonBuilder()
            .setCustomId(`vote_${category}_${taskId}`)
            .setLabel(label)
            .setStyle(ButtonStyle.Secondary);
    });

    const pollDuration = getTaskPollDurationMs();
    const endTime = Date.now() + pollDuration;
    const endsAt = new Date(endTime);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(taskButtons);

    const embed = buildTaskPollEmbed(category, selectedTasks, taskVotes, { endsAt });
    const files = getTaskPollIconFile(category);

    const message = await channel.send({
        embeds: [embed],
        components: [row],
        ...(files.length ? { files } : {}),
    });
    activeVotes.set(message.id, taskVotes);
    activePollSelections.set(message.id, selectedTasks);

    const poll: TaskPoll = {
        id: message.id,
        type: "task",
        category,
        options: selectedTasks,
        messageId: message.id,
        channelId,
        createdAt: new Date(),
        endsAt: new Date(endTime),
        isActive: true,
        votes: {},
    };

    await repo.createTaskPoll(poll);

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: pollDuration
    });

    collector.on('collect', async (interaction: ButtonInteraction) => {
        try {
            await interaction.deferUpdate();
        } catch (err) {
            if ((err as Error & { code?: number }).code === 10062) {
                console.warn("[TaskPoll] Interaction already acknowledged or expired.");
                return;
            }
            throw err;
        }

        const userId = interaction.user.id;
        const voteId = interaction.customId.split('_').slice(2).join('_');
        const currentVotes = activeVotes.get(message.id);
        if (!currentVotes) return;

        let firstTime = false;
        try {
            const result = await repo.voteInPollOnce(poll.id, userId, voteId);
            firstTime = result.firstTime;
        } catch (err) {
            console.error("[TaskPoll] Failed to record vote transaction:", err);
            await interaction.followUp({ content: "An error occurred while recording your vote.", flags: 1 << 6 });
            return;
        }

        const previousVoteId = userVotes.get(userId);

        // Prevent double voting unless changing vote
        if (previousVoteId && previousVoteId !== voteId) {
            currentVotes.set(previousVoteId, (currentVotes.get(previousVoteId) || 1) - 1);
        }

        if (!previousVoteId || previousVoteId !== voteId) {
            currentVotes.set(voteId, (currentVotes.get(voteId) || 0) + 1);
            userVotes.set(userId, voteId);
        }

        if (firstTime) {
            const userRepo = services.repos.userRepo;
            if (userRepo) {
                try {
                    await userRepo.incrementStat(userId, "taskPollsVoted", 1);
                } catch (err) {
                    console.warn(`[Stats] Failed to increment taskPollsVoted for ${interaction.user.username}:`, err);
                }
            } else {
                console.warn("[Stats] UserRepo unavailable; skipping taskPollsVoted increment.");
            }
        }

        const updatedEmbed = buildTaskPollEmbed(category, selectedTasks, currentVotes, { endsAt });

        await interaction.editReply({ embeds: [updatedEmbed] });
        await interaction.followUp({ content: "Thank you for your vote!", flags: 1 << 6 });

        poll.votes[userId] = voteId;
        await repo.createTaskPoll(poll);
    });

    collector.on('end', async () => {
        const finalVotes = activeVotes.get(message.id);
        if (!finalVotes) return;

        const updatedEmbed = buildTaskPollEmbed(category, selectedTasks, finalVotes, { isClosed: true });

        await message.edit({ embeds: [updatedEmbed], components: [] });
        activeVotes.delete(message.id);
        activePollSelections.delete(message.id);
        await repo.closeTaskPoll(poll.id);
        console.log(`[TaskPoll] Poll closed for ${category}.`);
    });
}

function buildVoteMapFromPoll(poll: TaskPoll): Map<string, number> {
    const voteMap = new Map<string, number>();
    for (const option of poll.options) {
        voteMap.set(option.id, 0);
    }

    Object.values(poll.votes ?? {}).forEach((optionId) => {
        voteMap.set(optionId, (voteMap.get(optionId) ?? 0) + 1);
    });

    return voteMap;
}

export function syncActivePollSelection(pollId: string, updatedTask: Task) {
    const tasks = activePollSelections.get(pollId);
    if (!tasks) return;

    const index = tasks.findIndex((task) => task.id === updatedTask.id);
    if (index === -1) return;

    tasks[index] = { ...tasks[index], ...updatedTask };
    activePollSelections.set(pollId, tasks);
}

export async function refreshTaskPollMessage(client: Client, poll: TaskPoll) {
    if (!poll.messageId || !poll.channelId) return;

    const channel = await client.channels.fetch(poll.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const textChannel = channel as TextChannel;
    const message = await textChannel.messages.fetch(poll.messageId).catch(() => null);
    if (!message) return;

    const voteMap = buildVoteMapFromPoll(poll);
    activeVotes.set(poll.messageId, voteMap);

    const options = poll.options;
    if (activePollSelections.has(poll.messageId)) {
        const stored = activePollSelections.get(poll.messageId)!;
        for (const option of options) {
            const idx = stored.findIndex(task => task.id === option.id);
            if (idx !== -1) {
                stored[idx] = { ...stored[idx], ...option };
            }
        }
    } else {
        activePollSelections.set(poll.messageId, options);
    }
    const category = poll.category as TaskCategory;
    const rawEndsAt = poll.endsAt as unknown;
    let endsAtDate: Date | null = null;
    if (rawEndsAt instanceof Date) {
        endsAtDate = rawEndsAt;
    } else if (rawEndsAt && typeof (rawEndsAt as any).toDate === 'function') {
        endsAtDate = (rawEndsAt as any).toDate();
    } else if (typeof rawEndsAt === 'number') {
        endsAtDate = new Date(rawEndsAt);
    } else if (typeof rawEndsAt === 'string') {
        const parsed = new Date(rawEndsAt);
        endsAtDate = Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        options.map((task, i) =>
            new ButtonBuilder()
                .setCustomId(`vote_${category}_${task.id}`)
                .setLabel(`${emojiNumbers[i]} ${task.shortName ?? `Task ${i + 1}`}`)
                .setStyle(ButtonStyle.Secondary)
        )
    );

    const updatedEmbed = buildTaskPollEmbed(category, options, voteMap, {
        endsAt: endsAtDate,
        isClosed: !poll.isActive,
    });
    const files = getTaskPollIconFile(category);

    await message.edit({
        embeds: [updatedEmbed],
        components: [buttonRow],
        ...(files.length ? { files } : {}),
    });
}
