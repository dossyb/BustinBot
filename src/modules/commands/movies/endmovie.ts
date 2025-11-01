import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { finishMovieNight } from "../../movies/MovieLifecycle.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";

const endmovie: Command = {
    name: 'endmovie',
    description: 'Manually end the current movie night and archive the movie.',
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName('endmovie')
        .setDescription('Manually end the current movie night and archive the movie.'),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const result = await finishMovieNight(interaction.user.username, services, interaction.client);

        if (!result.success) {
            await interaction.editReply(result.message);
            return;
        }

        const guild = interaction.guild;
        const channel = guild?.channels.cache.find(
            (ch) => ch.name === 'movie-night' && ch.isTextBased()
        ) as TextChannel | undefined;

        if (result.finishedMovie && channel) {
            await channel.send({
                content: `🎞️ Movie night has ended! Thanks for watching!`,
            });
        }

        await interaction.editReply("Movie night successfully ended and archived.");
    }
};

export default endmovie;