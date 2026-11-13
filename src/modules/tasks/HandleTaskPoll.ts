import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client, type ButtonInteraction, type GuildTextBasedChannel, MessageFlags } from "discord.js";
import { DateTime, Duration } from "luxon";
import { countBy } from "es-toolkit";
import type { Task } from "../../models/Task.js";
import type { TaskPoll } from "../../models/TaskPoll.js";
import { TaskCategory } from "../../models/Task.js";
import { selectTasksForCategory } from "./TaskSelector.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import type { Guild } from "../../models/Guild.js";
import { buildTaskPollEmbed, getTaskPollIconFile } from "./TaskEmbeds.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../utils/MentionUtils.js";
import { configuredChannel } from "../../utils/ChannelUtils.js";

const emojiNumbers = ["1️⃣", "2️⃣", "3️⃣"];
const PROD_TASK_POLL_DURATION = Duration.fromObject({ hours: 24 });
const DEV_TASK_POLL_DURATION = Duration.fromObject({ minutes: 5 });

function getTaskPollDuration(): Duration {
    return process.env.BOT_MODE === "dev" ? DEV_TASK_POLL_DURATION : PROD_TASK_POLL_DURATION;
}

function buildPollMessage(poll: Omit<TaskPoll, "id" | "messageId">) {
    const { category } = poll;
    const embed = buildTaskPollEmbed(
        category,
        poll.options,
        countBy(Object.values(poll.votes), (taskId) => taskId),
        poll.isActive ? { endsAt: poll.endsAt } : { isClosed: true }
    );
    const buttons = poll.options.map((task, i) =>
        new ButtonBuilder()
            .setCustomId(`vote_${category}_${task.id}`)
            .setLabel(`${emojiNumbers[i]} ${task.shortName ?? `Task ${i + 1}`}`)
            .setStyle(ButtonStyle.Secondary)
    );
    const files = getTaskPollIconFile(category);

    return {
        embeds: [embed],
        components: poll.isActive ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [],
        ...(files.length ? { files } : {}),
    };
}

export async function handleTaskPollVoteInteraction(
    interaction: ButtonInteraction,
    services: ServiceContainer
) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [, categoryRaw, voteId] = interaction.customId.split("_");
    const category = Object.values(TaskCategory).find((value) => value === categoryRaw);
    if (!category || !voteId) {
        await interaction.editReply({ content: "Invalid poll vote option." });
        return;
    }

    const taskRepo = services.repos.taskRepo;

    const poll = await taskRepo.getTaskPollById(interaction.message.id);
    if (!poll?.isActive || poll.endsAt.getTime() <= Date.now()) {
        await interaction.editReply({ content: "This poll has closed." });
        return;
    }

    if (poll.category !== category) {
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
        try {
            await userRepo.incrementStat(interaction.user.id, "taskPollsVoted", 1);
        } catch (err) {
            console.warn(`[Stats] Failed to increment taskPollsVoted for ${interaction.user.username}:`, err);
        }
    }

    try {
        await interaction.message.edit(buildPollMessage(updatedPoll));
    } catch (err) {
        console.warn(`[TaskPoll] Failed to update the poll message for ${poll.id}:`, err);
    }
    await interaction.editReply({ content: "Thank you for your vote!" });
}

export function weeklyTaskCategories(guildConfig: Guild): TaskCategory[] {
    return [
        TaskCategory.PvM,
        TaskCategory.Skilling,
        TaskCategory.MinigameMisc,
        ...(guildConfig.toggles?.leaguesEnabled ? [TaskCategory.Leagues] : []),
    ];
}

export async function announceToTaskUsers(
    channel: GuildTextBasedChannel,
    services: ServiceContainer,
    guildConfig: Guild,
    text: string
): Promise<void> {
    const roleId = guildConfig.roles?.taskUser;
    const role = roleId ? channel.guild.roles.cache.get(roleId) : null;
    if (!role) {
        console.warn(`[Tasks] Task user role not configured or not found.`);
    }
    const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);
    await channel.send(withSuppressedMentions({ content: role ? `<@&${role.id}> ${text}` : text }, suppressMentions));
}

export async function postAllTaskPolls(client: Client, services: ServiceContainer) {
    const guildConfig = await services.guilds.get(services.guildId);
    if (!guildConfig) {
        console.warn(`[TaskPoll] Guild configuration missing for ${services.guildId}.`);
        return;
    }

    const channel = await configuredChannel(client, services, "taskChannel");
    if (!channel) return;

    await announceToTaskUsers(
        channel,
        services,
        guildConfig,
        "**New task polls are live!** Cast your votes for each category below:"
    );

    for (const category of weeklyTaskCategories(guildConfig)) {
        await postTaskPollForCategory(client, services, category, channel);
    }
}

export async function postTaskPollForCategory(
    client: Client,
    services: ServiceContainer,
    category: TaskCategory,
    channelOverride?: GuildTextBasedChannel
) {
    const channel = channelOverride ?? (await configuredChannel(client, services, "taskChannel"));
    if (!channel) return;

    const repo = services.repos.taskRepo;

    const allTasks: Task[] = await services.tasks.getAllTasks();
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

    const createdAt = new Date();
    const draft: Omit<TaskPoll, "id" | "messageId"> = {
        type: "task",
        category,
        options: selectedTasks,
        channelId: channel.id,
        createdAt,
        endsAt: DateTime.fromJSDate(createdAt).plus(getTaskPollDuration()).toJSDate(),
        isActive: true,
        votes: {},
    };

    const message = await channel.send(buildPollMessage(draft));
    await repo.createTaskPoll({ ...draft, id: message.id, messageId: message.id });
}

export async function refreshTaskPollMessage(client: Client, poll: TaskPoll) {
    if (!poll.messageId || !poll.channelId) return;

    const channel = await client.channels.fetch(poll.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const message = await channel.messages.fetch(poll.messageId).catch(() => null);
    if (!message) return;

    await message.edit(buildPollMessage(poll));
}
