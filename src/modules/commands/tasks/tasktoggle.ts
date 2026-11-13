import { SlashCommandBuilder, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { initTaskScheduler, stopTaskScheduler } from "../../tasks/TaskScheduler.js";

const tasktoggle: Command = {
    name: "tasktoggle",
    description: "Toggle task automations on and off.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("tasktoggle")
        .setDescription("Toggle task automations on and off.")
        .addSubcommand((sub) =>
            sub
                .setName("schedule")
                .setDescription("Toggle the task scheduler on and off.")
        )
        .addSubcommand((sub) =>
            sub
                .setName("leaderboard")
                .setDescription("Toggle periodic leaderboard automation on and off.")
        ),

    async execute({ interaction, services }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guildId;
        const guildService = services.guilds;

        const sub = interaction.options.getSubcommand();

        // Fetch the latest guild config from Firestore
        const guildConfig = await guildService.get(guildId);

        if (sub === "schedule") {
            const currentState = guildConfig?.toggles?.taskScheduler ?? false;
            const newState = !currentState;

            if (newState) {
                // Enable scheduler
                await initTaskScheduler(interaction.client, services);
            } else {
                // Disable scheduler
                await stopTaskScheduler(guildId);
            }

            await guildService.updateToggle(
                guildId,
                "taskScheduler",
                newState,
                interaction.user.id
            );

            await interaction.editReply({
                content: newState
                    ? `✅ Task scheduler **enabled** and started for this guild.`
                    : `⏹️ Task scheduler **disabled** and stopped for this guild.`,
            });
            return;
        }

        if (sub === "leaderboard") {
            const currentState = guildConfig?.toggles?.taskLeaderboard ?? true;
            const newState = !currentState;

            await guildService.updateToggle(
                guildId,
                "taskLeaderboard",
                newState,
                interaction.user.id
            );

            await interaction.editReply({
                content: newState
                    ? "🏆 Periodic leaderboard automation **enabled**."
                    : "🧊 Periodic leaderboard automation **disabled** (read-only mode).",
            });
            return;
        }

        await interaction.editReply({ content: "Unknown tasktoggle option." });
    },
};

export default tasktoggle;
