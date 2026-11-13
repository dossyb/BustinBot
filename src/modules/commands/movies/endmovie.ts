import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { finishMovieNight } from "../../movies/MovieLifecycle.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { configuredChannel } from "../../../utils/ChannelUtils.js";

const endmovie: Command = {
    name: "endmovie",
    description: "Manually end the current movie night and archive the movie.",
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName("endmovie")
        .setDescription("Manually end the current movie night and archive the movie."),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = await finishMovieNight(interaction.user.username, services, interaction.client);

        if (!result.success) {
            await interaction.editReply(result.message);
            return;
        }

        if (result.finishedMovie) {
            const channel = await configuredChannel(interaction.client, services, "movieNight");
            await channel?.send({
                content: `🎞️ Movie night has ended. Thanks for watching **${result.finishedMovie.title}**!`,
            });
        }

        await interaction.editReply(result.message);
    }
};

export default endmovie;
