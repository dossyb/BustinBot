import { SlashCommandBuilder, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";

const leagues: Command = {
    name: "leagues",
    description: "Toggle inclusion of Leagues tasks in polls and events.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin],

    slashData: new SlashCommandBuilder()
        .setName("leagues")
        .setDescription("Toggle Leagues tasks in polls and events on/off."),

    async execute({ interaction, services }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guildId;

        const userId = interaction.user.id;

        const guildConfig = await services.guilds.get(guildId);
        const current = guildConfig?.toggles?.leaguesEnabled ?? false;

        const newState = !current;
        await services.guilds.updateToggle(guildId, "leaguesEnabled", newState, userId);

        const status = newState ? "**enabled**" : "**disabled**";

        await interaction.editReply({
            content: `Leagues tasks have been ${status}.`,
        });

        console.log(`[Leagues Toggle] ${interaction.guild?.name ?? guildId}: ${status}`);
    }
}

export default leagues;