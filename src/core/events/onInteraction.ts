import { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../models/Command';
import { CommandRole } from '../../models/Command';

export async function handleInteraction(
    interaction: ChatInputCommandInteraction,
    commands: Map<string, Command>
) {
    const command = commands.get(interaction.commandName);
    if (!command) {
        await interaction.reply({ content: 'Command not found.', ephemeral: true });
        return;
    }

    // Simple placeholder permission check
    if (!command.allowedRoles.includes(CommandRole.Everyone)) {
        await interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
        return;
    }

    try {
        await command.execute({ interaction });
    } catch (error) {
        console.error(`[Slash Command Error]: ${command.name}`, error);
        await interaction.reply({ content: 'There was an error executing that command.', ephemeral: true });
    }
}
