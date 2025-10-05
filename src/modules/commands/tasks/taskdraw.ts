import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../../models/Command';
import { CommandRole } from '../../../models/Command';
import { generatePrizeDrawSnapshot, rollWinnerForSnapshot, announcePrizeDrawWinner } from '../../tasks/HandlePrizeDraw';

const taskdraw: Command = {
    name: 'taskdraw',
    description: 'Manually trigger a task prize draw.',
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('taskdraw')
        .setDescription('Manually trigger a task prize draw.')
        .addStringOption(option =>
            option
                .setName('action')
                .setDescription('Which step of the prize draw to run')
                .setRequired(true)
                .addChoices(
                    { name: 'Generate Snapshot', value: 'snapshot' },
                    { name: 'Roll Winner', value: 'roll' },
                    { name: 'Announce Winner', value: 'announce' }
                )
        )
        .addStringOption(option =>
            option
                .setName('snapshot_id')
                .setDescription('The snapshot ID to use (required for roll/announce)')
                .setRequired(false)
        ),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        const action = interaction.options.getString('action', true);
        const snapshotId = interaction.options.getString('snapshot_id') ?? '';

        await interaction.deferReply({ flags: 1 << 6 });

        try {
            if (action === 'snapshot') {
                const snapshot = generatePrizeDrawSnapshot();
                await interaction.editReply({
                    content: `Snapshot created for period **${snapshot.id}** with **${snapshot.totalEntries}** entries.`
                });
                return;
            }

            if (action === 'roll') {
                if (!snapshotId) {
                    await interaction.editReply('You must provide a snapshot ID to roll a winner.');
                    return;
                }
                const winner = rollWinnerForSnapshot(snapshotId);
                if (winner) {
                    await interaction.editReply(`Winner rolled for **${snapshotId}**: <@${winner}>`);
                } else {
                    await interaction.editReply(`No eligible entries found for **${snapshotId}**.`);
                }
                return;
            }

            if (action === 'announce') {
                if (!snapshotId) {
                    await interaction.editReply('You must provide a snapshot ID to announce a winner.');
                    return;
                }
                await announcePrizeDrawWinner(interaction.client, snapshotId);
                await interaction.editReply(`Announcement sent for **${snapshotId}**.`);
                return;
            }
        } catch (err) {
            console.error('[TaskDraw Command Error]', err);
            await interaction.editReply(`An error occurred while running /taskdraw: ${String(err)}`);
        }
    }
};

export default taskdraw;