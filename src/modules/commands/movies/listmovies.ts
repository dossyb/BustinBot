import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { buildMovieListPage } from "../../movies/MovieList.js";

const listmovies: Command = {
    name: "listmovies",
    description: "Show the list of movies added for movie night.",
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName("listmovies")
        .setDescription("View the current movie list with pagination."),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        await interaction.editReply(await buildMovieListPage(services, 0));
    },
};

export default listmovies;