import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, time, TimestampStyles, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import type { UserStats } from "../../../models/UserStats.js";
import { packageVersion } from "../../../utils/version.js";

const stats: Command = {
    name: "stats",
    description: "View user-specific BustinBot stats.",
    module: CommandModule.Core,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName("stats")
        .setDescription("View user-specific BustinBot stats.")
        .addUserOption((option) =>
            option
                .setName("user")
                .setDescription("View stats for another user.")
                .setRequired(false)
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer; }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const targetUser = interaction.options.getUser("user") ?? interaction.user;
        const userRepo = services.repos.userRepo;

        let stats: UserStats | null = null;
        try {
            stats = await userRepo.getUserById(targetUser.id);
        } catch (err) {
            console.error("[Stats Command] Failed to fetch user stats:", err);
            await interaction.editReply("Failed to retrieve your stats. Please try again later.");
            return;
        }

        if (!stats) {
            await interaction.editReply(`No stats found for ${targetUser.username}. They may not have interacted with me yet.`);
            return;
        }

        const joinedDate = stats.joinedAt ? time(stats.joinedAt, TimestampStyles.LongDate) : "Unknown";
        const lastActive = stats.lastActiveAt ? time(stats.lastActiveAt, TimestampStyles.LongDate) : "Unknown";

        const embed = new EmbedBuilder()
            .setColor(0x00ae86)
            .setAuthor({ name: `${targetUser.username}'s Stats`, iconURL: targetUser.displayAvatarURL() })
            .setDescription(`📊 **BustinBot Stats Overview**`)
            .addFields([
                { name: "🕧 First Active", value: joinedDate, inline: true },
                { name: "💬 Last Active", value: lastActive, inline: true },
                { name: "🕹️ Commands Run", value: `${stats.commandsRun ?? 0}`, inline: true }
            ])
            .addFields([
                {
                    name: "🎥 Movie Module",
                    value: [
                        `🎞️ Movies Added: **${stats.moviesAdded ?? 0}**`,
                        `🎗️ Movies Chosen for Movie Night: **${stats.moviesWatched ?? 0}**`,
                        `🍿 Movie Nights Attended: **${stats.moviesAttended ?? 0}**`,
                        `🗳️ Movie Polls Voted: **${stats.moviePollsVoted ?? 0}**`,
                    ].join("\n"),
                    inline: false,
                },
                {
                    name: "🗺️ Task Module",
                    value: [
                        `🥉 Bronze Tasks: **${stats.tasksCompletedBronze ?? 0}**`,
                        `🥈 Silver Tasks: **${stats.tasksCompletedSilver ?? 0}**`,
                        `🥇 Gold Tasks: **${stats.tasksCompletedGold ?? 0}**`,
                        `🔥 Current Task Streak: **${stats.taskStreak ?? 0}**`,
                        `🏅 Longest Task Streak: **${stats.longestTaskStreak ?? 0}**`,
                        `🏆 Prizes Won: **${stats.taskPrizesWon ?? 0}**`,
                        `🗳️ Task Polls Voted: **${stats.taskPollsVoted ?? 0}**`,
                    ].join("\n"),
                    inline: false,
                },
            ])
            .setFooter({
                text: `BustinBot ${packageVersion} • Developed by dossyb`,
            });

        await interaction.editReply({ embeds: [embed] });
    }
}

export default stats;
