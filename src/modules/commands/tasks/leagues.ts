import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";

const leagues: Command = {
    name: 'leagues',
    description: 'Toggle inclusion of Leagues tasks in polls and events.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin],

    slashData: new SlashCommandBuilder()
        .setName('leagues')
        .setDescription('Toggle Leagues tasks in polls and events on/off.'),

    async execute({ interaction, services }) {
        if (!interaction) return;

        const repo = services.repos?.guildRepo;
        if (!repo) {
            await interaction.reply({
                content: "Guild repository unavailable.",
                flags: 1 << 6,
            });
            return;
        }

        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({
                content: "This command must be used inside a server.",
                flags: 1 << 6
            });
            return;
        }

        const userId = interaction.user.id;

        const guildConfig = await repo.getGuild(guildId);
        const current = guildConfig?.toggles?.leaguesEnabled ?? false;

        const newState = !current;
        await repo.updateToggle(guildId, "toggles.leaguesEnabled", newState, userId);

        const status = newState ? '**enabled**' : '**disabled**';

        await interaction.reply({
            content: `Leagues tasks have been ${status}.`,
            flags: 1 << 6
        });

        console.log(`[Leagues Toggle] ${interaction.guild?.name ?? guildId}: ${status}`);
    }
}

export default leagues;