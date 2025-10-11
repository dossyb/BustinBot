import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import type { Command } from '../../../models/Command';
import { CommandRole } from '../../../models/Command';
import { closeActiveMoviePoll } from '../../movies/MoviePolls';
import { createMoviePollClosedEmbed } from '../../movies/MovieEmbeds';

const closemoviepoll: Command = {
    name: 'closemoviepoll',
    description: 'Manually close the active movie poll and announce the winner.',
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName('closemoviepoll')
        .setDescription('Manually close the active movie poll and announce the winner.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const result = await closeActiveMoviePoll(interaction.user.username);

        if (!result.success) {
            await interaction.editReply(`${result.message}`);
            return;
        }

        const guild = interaction.guild;
        const channel = guild?.channels.cache.find(
            (ch) => ch.name === 'movie-night' && ch.isTextBased()
        ) as TextChannel | undefined;

        if (result.winner && channel) {
            const embed = createMoviePollClosedEmbed(
                result.winner,
                interaction.user.username,
                result.winningVotes ?? 0,
                result.tieBreak ?? false
            );
            await channel.send({ embeds: [embed] });
        }

        await interaction.editReply(`✅ Movie poll closed successfully.\n${result.message}`);
    }
}

export default closemoviepoll;