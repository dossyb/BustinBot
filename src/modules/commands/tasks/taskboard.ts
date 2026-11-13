import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { postFinalLeaderboardSnapshot, postWeeklyLeaderboardSnapshot } from "../../tasks/HandleLeaderboardUpdate.js";

const taskboard: Command = {
    name: "taskboard",
    description: "Manually post the weekly task leaderboard update.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("taskboard")
        .setDescription("Manually post the weekly task leaderboard update.")
        .addSubcommand((sub) =>
            sub.setName("update").setDescription("Post the weekly leaderboard update.")
        )
        .addSubcommand((sub) =>
            sub.setName("final").setDescription("Post the final leaderboard snapshot.")
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const sub = interaction.options.getSubcommand();
            const posted =
                sub === "final"
                    ? await postFinalLeaderboardSnapshot(interaction.client, services)
                    : await postWeeklyLeaderboardSnapshot(interaction.client, services);
            if (!posted) {
                await interaction.editReply("Couldn't post the leaderboard: the task channel isn't set up or I can't reach it.");
            } else {
                await interaction.editReply(sub === "final" ? "Final leaderboard posted." : "Leaderboard update posted.");
            }
        } catch (err) {
            console.error("[TaskBoard Command Error]", err);
            await interaction.editReply("Failed to post the leaderboard. Check console for details.");
        }
    }
};

export default taskboard;
