import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { PICK_MOVIE_BUTTONS } from "../../movies/PickMovieInteractions.js";

const pickmovie: Command = {
    name: "pickmovie",
    description: "Pick the movie for the next movie night (via poll, random roll, or specific movie).",
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName("pickmovie")
        .setDescription("Pick the movie for the next movie night (via poll, random roll, or specific movie)."),

    async execute({ interaction }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(PICK_MOVIE_BUTTONS.choose)
                .setLabel("🎯 Choose a movie")
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId(PICK_MOVIE_BUTTONS.random)
                .setLabel("🎲 Random movie")
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId(PICK_MOVIE_BUTTONS.pollRandom)
                .setLabel("📊 Poll random movies")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId(PICK_MOVIE_BUTTONS.pollManual)
                .setLabel("🗳️ Poll specific movies")
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({
            content: "How would you like to pick the movie?",
            components: [row]
        });
    },
};

export default pickmovie;