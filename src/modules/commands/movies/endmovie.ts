import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { Command } from "../../../models/Command";
import { CommandRole } from "../../../models/Command";
import { finishMovieNight } from "../../movies/MovieLifecycle";

const endmovie: Command = {
    name: 'endmovie',
    description: 'Manually end the current movie night and archive the movie.',
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName('endmovie')
        .setDescription('Manually end the current movie night and archive the movie.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const result = await finishMovieNight(interaction.user.username);

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