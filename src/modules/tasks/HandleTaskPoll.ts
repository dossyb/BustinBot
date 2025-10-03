import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, TextChannel, Client, ButtonInteraction, ComponentType } from 'discord.js';
import fs from 'fs';
import path from 'path';
import type { Task } from '../../models/Task';

const taskFilePath = path.resolve(process.cwd(), 'src/data/tasks.json');
const pollPath = path.resolve(process.cwd(), 'src/data/activePoll.json');
const activeVotes = new Map<string, Map<string, number>>(); // messageId -> Map<taskId, voteCount>
const emojiNumbers = ['1️⃣', '2️⃣', '3️⃣'];

function getVoteSummary(tasks: Task[], voteMap: Map<string, number>): string {
    return tasks.map((task, i) => {
        const taskId = task.id.toString();
        const votes = voteMap.get(taskId) || 0;
        const name = task.taskName.replace('{amount}', task.amounts?.[0]?.toString() ?? '');
        return `${emojiNumbers[i]} ${name} — **${votes} vote${votes !== 1 ? 's' : ''}**`;
    }).join('\n');
}

export async function postTaskPoll(client: Client) {
    const userVotes = new Map<string, string>(); // userId -> taskId

    const guildId = process.env.DISCORD_GUILD_ID;
    const channelId = process.env.TASK_CHANNEL_ID;
    if (!guildId || !channelId) return;

    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const taskData: Task[] = JSON.parse(fs.readFileSync(taskFilePath, 'utf8'));
    if (taskData.length < 3) return;

    // Get 3 random tasks
    const selectedTasks = [...taskData]
        .sort(() => Math.random() - 0.5)
        .slice(0, 3);

    const taskVotes = new Map<string, number>();
    const taskButtons = selectedTasks.map((task, i) => {
        const taskId = task.id.toString();
        taskVotes.set(taskId, 0);

        const label = `${emojiNumbers[i]} ${task.shortName ?? `Task ${i + 1}`}`;

        return new ButtonBuilder()
            .setCustomId(`vote_${taskId}`)
            .setLabel(label)
            .setStyle(ButtonStyle.Secondary);
    });

    const pollDuration = 60_000;
    const endTime = Date.now() + pollDuration;
    const timeString = `<t:${Math.floor(endTime / 1000)}:R>`
    const footerText = `Click a button below to vote.`;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(taskButtons);

    const embed = new EmbedBuilder()
        .setTitle('🗳️ Vote for the next task')
        .setDescription(`${getVoteSummary(selectedTasks, taskVotes)}\n\n Poll closes ${timeString}`)
        .setFooter({ text: footerText })
        .setColor(0x00ae86);

    const message = await (channel as TextChannel).send({ embeds: [embed], components: [row] });
    activeVotes.set(message.id, taskVotes);

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: pollDuration
    });

    collector.on('collect', async (interaction: ButtonInteraction) => {
        const userId = interaction.user.id;
        const voteId = interaction.customId.replace('vote_', '');
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
            .setDescription(`${getVoteSummary(selectedTasks, taskVotes)}\n\n Poll closes ${timeString}`);

        await interaction.update({ embeds: [updatedEmbed] });

        // Persist vote state on every change
        const pollResult = {
            messageId: message.id,
            endTime: new Date().toISOString(),
            tasks: selectedTasks.map(task => ({
                id: task.id,
                shortName: task.shortName,
                votes: currentVotes.get(task.id.toString()) ?? 0
            }))
        };

        fs.writeFileSync(pollPath, JSON.stringify(pollResult, null, 2));
    });

    collector.on('end', async () => {
        const finalVotes = activeVotes.get(message.id);
        if (!finalVotes) return;

        const updatedEmbed = EmbedBuilder.from(embed)
            .setDescription(getVoteSummary(selectedTasks, finalVotes))
            .setFooter({ text: 'Poll closed. Thanks for voting!' });

        await message.edit({ embeds: [updatedEmbed], components: [] });
        activeVotes.delete(message.id);
        console.log('[TaskPoll] Poll closed. Final votes:', Object.fromEntries(finalVotes));
    });
}