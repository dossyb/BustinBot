import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { buildLeaderboardMessage } from "../../tasks/TaskLeaderboards.js";

const leaderboard: Command = {
    name: "leaderboard",
    description: "View the task leaderboards.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName("leaderboard")
        .setDescription("View the task leaderboards."),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const payload = await buildLeaderboardMessage(services, "lifetime", interaction.user.id, {
                client: interaction.client,
                guild: interaction.guild,
            });
            await interaction.editReply(payload);
        } catch (err) {
            await interaction.editReply("Leaderboard initialisation failed. Please use /reportbug if it continues.");
        }
    }
};

export default leaderboard;
