import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";

const setstreak: Command = {
    name: "setstreak",
    description: "Admin override to set a user's task streak.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin, CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("setstreak")
        .setDescription("Admin override to set a user's task streak.")
        .addUserOption((option) =>
            option
                .setName("user")
                .setDescription("User to update.")
                .setRequired(true)
        )
        .addIntegerOption((option) =>
            option
                .setName("streak")
                .setDescription("New current streak value.")
                .setRequired(true)
                .setMinValue(0)
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer; }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const userRepo = services.repos.userRepo;

        const targetUser = interaction.options.getUser("user", true);
        const streakValue = interaction.options.getInteger("streak", true);

        try {
            const stats = await userRepo.getUserById(targetUser.id);

            if (!stats) {
                await userRepo.incrementStat(targetUser.id, "taskStreak", streakValue);
                if (streakValue > 0) {
                    await userRepo.updateUser(targetUser.id, { longestTaskStreak: streakValue });
                }
            } else {
                const longest = Math.max(stats.longestTaskStreak ?? 0, streakValue);
                await userRepo.updateUser(targetUser.id, {
                    taskStreak: streakValue,
                    longestTaskStreak: longest,
                });
            }

            await interaction.editReply(
                `✅ Updated task streak for **${targetUser.username}** to **${streakValue}**.`
            );
        } catch (err) {
            console.error("[SetStreak Command] Failed to update streak:", err);
            await interaction.editReply("Failed to update the streak. Please try again later.");
        }
    }
};

export default setstreak;
