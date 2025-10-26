import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TextChannel, Client, ButtonInteraction, ComponentType } from 'discord.js';
import path from 'path';
import type { Task } from '../../models/Task';
import type { ITaskRepository } from '../../core/database/interfaces/ITaskRepo';
import type { TaskPoll } from '../../models/TaskPoll';
import { TaskCategory } from '../../models/Task';
import { fileURLToPath } from 'url';
import { selectTasksForCategory } from './TaskSelector';
import type { ServiceContainer } from 'core/services/ServiceContainer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const categoryIcons: Record<TaskCategory, string> = {
    [TaskCategory.PvM]: path.resolve(__dirname, '../../assets/icons/task_pvm.png'),
    [TaskCategory.Skilling]: path.resolve(__dirname, '../../assets/icons/task_skilling.png'),
    [TaskCategory.MinigameMisc]: path.resolve(__dirname, '../../assets/icons/task_minigame.png'),
    [TaskCategory.Leagues]: path.resolve(__dirname, '../../assets/icons/task_minigame.png'), // temp
};

const activeVotes = new Map<string, Map<string, number>>(); // messageId -> Map<taskId, voteCount>
const emojiNumbers = ['1️⃣', '2️⃣', '3️⃣'];

function getVoteSummary(tasks: Task[], voteMap: Map<string, number>): string {
    return tasks.map((task, i) => {
        const taskId = task.id.toString();
        const votes = voteMap.get(taskId) || 0;
        const name = task.taskName;

        const tierDisplay = `🥉 **${task.amtBronze}** 🥈 **${task.amtSilver}** 🥇 **${task.amtGold}**`;
        const voteText = `**${votes} vote${votes !== 1 ? 's' : ''}**`;
        return `${emojiNumbers[i]} ${name}\n${tierDisplay}\n${voteText}`;
    }).join('\n\n');
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

    const mention = role ? `<@&${role.id}>` : '';
    if (!role) {
        console.warn(`[TaskPoll] Task user role not configured or not found.`);
    }
    await (channel as TextChannel).send(`${mention} **New task polls are live!** Cast your votes for each category below:`);

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

    const pollDuration = 60_000;
    const endTime = Date.now() + pollDuration;
    const timeString = `<t:${Math.floor(endTime / 1000)}:R>`
    const footerText = `Click a button below to vote.`;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(taskButtons);

    const iconPath = categoryIcons[category];

    const embed = new EmbedBuilder()
        .setTitle(`🗳️ ${category} Task Poll`)
        .setDescription(`${getVoteSummary(selectedTasks, taskVotes)}\n\n Poll closes ${timeString}`)
        .setFooter({ text: footerText })
        .setColor(0x00ae86)
        .setThumbnail('attachment://category_icon.png');

    const message = await channel.send({
        embeds: [embed],
        components: [row],
        files: [{ attachment: iconPath, name: 'category_icon.png' }],
    });
    activeVotes.set(message.id, taskVotes);

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
        const userId = interaction.user.id;
        const voteId = interaction.customId.split('_').slice(2).join('_');
        const currentVotes = activeVotes.get(message.id);
        if (!currentVotes) return;

        const previousVoteId = userVotes.get(userId);

        // Prevent double voting unless changing vote
        if (previousVoteId && previousVoteId !== voteId) {
            currentVotes.set(previousVoteId, (currentVotes.get(previousVoteId) || 1) - 1);
        }

        if (!previousVoteId || previousVoteId !== voteId) {
            currentVotes.set(voteId, (currentVotes.get(voteId) || 0) + 1);
            userVotes.set(userId, voteId);
        }

        const updatedEmbed = EmbedBuilder.from(embed)
            .setDescription(`${getVoteSummary(selectedTasks, currentVotes)}\n\n Poll closes ${timeString}`);

        await interaction.update({ embeds: [updatedEmbed] });

        poll.votes[userId] = voteId;
        await repo.createTaskPoll(poll);
    });

    collector.on('end', async () => {
        const finalVotes = activeVotes.get(message.id);
        if (!finalVotes) return;

        const updatedEmbed = EmbedBuilder.from(embed)
            .setDescription(getVoteSummary(selectedTasks, finalVotes))
            .setFooter({ text: 'Poll closed. Thanks for voting!' });

        await message.edit({ embeds: [updatedEmbed], components: [] });
        activeVotes.delete(message.id);
        await repo.closeTaskPoll(poll.id);
        console.log(`[TaskPoll] Poll closed for ${category}.`);
    });
}
