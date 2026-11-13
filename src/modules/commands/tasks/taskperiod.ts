import { SlashCommandBuilder, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { resetPeriodicLeaderboard } from "../../tasks/TaskLeaderboards.js";

const taskperiod: Command = {
    name: "taskperiod",
    description: "Configure the periodic leaderboard length.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin, CommandRole.TaskAdmin],

    slashData: new SlashCommandBuilder()
        .setName("taskperiod")
        .setDescription("Configure the periodic leaderboard length.")
        .addSubcommand((sub) =>
            sub
                .setName("set")
                .setDescription("Set the number of task events per leaderboard period.")
                .addIntegerOption((opt) =>
                    opt
                        .setName("events")
                        .setDescription("Number of task events per period.")
                        .setRequired(true)
                        .addChoices(
                            { name: "2 task events", value: 2 },
                            { name: "4 task events", value: 4 },
                            { name: "8 task events", value: 8 },
                            { name: "12 task events", value: 12 }
                        )
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName("start")
                .setDescription("Start a fresh periodic leaderboard so the next task event is counted as the first.")
        ),

    async execute({ interaction, services }) {
        if (!interaction) return;

        const guildId = interaction.guildId;
        const subcommand = interaction.options.getSubcommand();

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            if (subcommand === "set") {
                const events = interaction.options.getInteger("events", true);
                await services.guilds.update(guildId, { taskSettings: { periodEvents: events } });
                await interaction.editReply(
                    `Periodic leaderboard length set to **${events}** task events. This will apply after the current period ends.`
                );
                return;
            }

            if (subcommand === "start") {
                await resetPeriodicLeaderboard(services);
                await interaction.editReply(
                    "Periodic leaderboard reset. The next task event will be counted as the first event of the new period."
                );
                return;
            }

            await interaction.editReply("Unknown taskperiod subcommand.");
        } catch (err) {
            console.error("[TaskPeriod Command Error]", err);
            await interaction.editReply("Failed to update the periodic leaderboard length. Check console for details.");
        }
    }
};

export default taskperiod;
