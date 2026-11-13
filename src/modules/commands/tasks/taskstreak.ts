import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, time, TimestampStyles, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { calculateTaskStreakSummary } from "../../tasks/TaskStreaks.js";
import { packageVersion } from "../../../utils/version.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";

const taskstreak: Command = {
    name: "taskstreak",
    description: "View your current task streak and streak deadline.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName("taskstreak")
        .setDescription("View your current task streak and streak deadline."),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer; }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const taskRepo = services.repos.taskRepo;

        const now = new Date();
        let summary: Awaited<ReturnType<typeof calculateTaskStreakSummary>>;
        try {
            summary = await calculateTaskStreakSummary(interaction.user.id, taskRepo, now);
        } catch (err) {
            console.error(`[TaskStreak] Failed to calculate streak for ${interaction.user.id}:`, err);
            await interaction.editReply("Failed to calculate your task streak. Please try again later.");
            return;
        }

        let displayCurrent = summary.currentStreak;
        let displayLongest = summary.longestStreak;

        const userRepo = services.repos.userRepo;
        try {
            const stats = await userRepo.getUserById(interaction.user.id);
            if (stats) {
                displayCurrent = stats.taskStreak ?? displayCurrent;
                displayLongest = stats.longestTaskStreak ?? displayLongest;
            }
        } catch (err) {
            console.warn(`[TaskStreak] Failed to load user streak stats for ${interaction.user.id}:`, err);
        }

        let deadlineLine = "No active task period right now.";
        if (summary.currentPeriod) {
            const absoluteEnd = time(summary.currentPeriod.end, TimestampStyles.LongDateTime);
            const relativeEnd = time(summary.currentPeriod.end, TimestampStyles.RelativeTime);
            if (summary.hasCompletedCurrentPeriod) {
                deadlineLine = `✅ Streak kept active for this period. Period ends ${absoluteEnd} (${relativeEnd}).`;
            } else {
                deadlineLine = `⏳ Submit before ${absoluteEnd} (${relativeEnd}) to preserve your streak.`;
            }
        }

        const embed = new EmbedBuilder()
            .setColor(0xa60000)
            .setAuthor({ name: `${interaction.user.username}'s Task Streak`, iconURL: interaction.user.displayAvatarURL() })
            .setDescription("Track your weekly task streak progress.")
            .addFields(
                { name: "🔥 Current Streak", value: `${displayCurrent}`, inline: true },
                { name: "🏅 Longest Streak", value: `${displayLongest}`, inline: true },
                { name: "⏰ Deadline", value: deadlineLine, inline: false },
            )
            .setFooter({ text: `BustinBot ${packageVersion} • Developed by dossyb` });

        await interaction.editReply({ embeds: [embed] });
    }
};

export default taskstreak;
