import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import type { Command } from '../../../models/Command';
import { CommandModule, CommandRole } from '../../../models/Command';
import { closeActiveMoviePoll } from '../../movies/MoviePolls';
import { createMoviePollClosedEmbed } from '../../movies/MovieEmbeds';
import type { ServiceContainer } from '../../../core/services/ServiceContainer';

const closemoviepoll: Command = {
    name: 'closemoviepoll',
    description: 'Manually close the active movie poll and announce the winner.',
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName('closemoviepoll')
        .setDescription('Manually close the active movie poll and announce the winner.'),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const result = await closeActiveMoviePoll(services, interaction.client, interaction.user.id);

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
