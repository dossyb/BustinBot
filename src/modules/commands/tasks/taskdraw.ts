import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../../models/Command';
import { CommandRole } from '../../../models/Command';
import { generatePrizeDrawSnapshot, rollWinnerForSnapshot, announcePrizeDrawWinner } from '../../tasks/HandlePrizeDraw';
import type { ServiceContainer } from '../../../core/services/ServiceContainer';

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

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;

        const prizeRepo = services.repos.prizeRepo;
        const taskRepo = services.repos.taskRepo;

        if (!prizeRepo || !taskRepo) {
            await interaction.reply({ content: 'Required repositories are unavailable.', flags: 1 << 6 });
            return;
        }

        const action = interaction.options.getString('action', true);
        const snapshotId = interaction.options.getString('snapshot_id') ?? '';

        await interaction.deferReply({ flags: 1 << 6 });

        try {
            if (action === 'snapshot') {
                const snapshot = await generatePrizeDrawSnapshot(prizeRepo, taskRepo);
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
                const winner = await rollWinnerForSnapshot(prizeRepo, snapshotId);
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
                const announced = await announcePrizeDrawWinner(interaction.client, prizeRepo, snapshotId);
                if (announced) {
                    await interaction.editReply(`Announcement sent for **${snapshotId}**.`);
                } else {
                    await interaction.editReply(`Unable to announce winner for **${snapshotId}**. Ensure a winner has been rolled and the announcement channel exists.`);
                }
                return;
            }
        } catch (err) {
            console.error('[TaskDraw Command Error]', err);
            await interaction.editReply(`An error occurred while running /taskdraw: ${String(err)}`);
        }
    }
};

export default taskdraw;