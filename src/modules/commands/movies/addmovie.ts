import { SlashCommandBuilder, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { presentMovieSelection } from "../../movies/MovieSelector.js";
import { checkCanAddMovie } from "../../movies/MovieService.js";

const addmovie: Command = {
    name: "addmovie",
    description: "Add a movie to the watchlist by searching TMDb.",
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName("addmovie")
        .setDescription("Add a movie to the watchlist.")
        .addStringOption(option =>
            option.setName("title")
                .setDescription("The movie title to search for.")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName("year")
                .setDescription("(Optional) Release year of the movie")
                .setRequired(false)
        ),

    async execute({ interaction, services }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const refusal = await checkCanAddMovie(services, interaction);
            if (refusal) {
                await interaction.editReply(refusal);
                return;
            }

            const query = interaction.options.getString("title", true);
            const year = interaction.options.getInteger("year", false) ?? undefined;
            // Present top search results from TMDb and let user choose one
            await presentMovieSelection(interaction, query, year);
        } catch (error) {
            console.error("[AddMovie Command Error]", error);
            await interaction.editReply(
                "An error occurred while adding the movie. Check console for details."
            );
        }
    },
};

export default addmovie;