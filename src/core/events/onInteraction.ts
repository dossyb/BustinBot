import { ChatInputCommandInteraction, GuildMember, ButtonInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import type { Interaction } from 'discord.js';
import type { Command } from '../../models/Command';
import { CommandRole } from '../../models/Command';
import { handleTaskInteraction } from '../../modules/tasks/TaskInteractions';

export async function handleInteraction(
    interaction: Interaction,
    commands: Map<string, Command>
) {
    if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command) {
            await interaction.reply({ content: 'Command not found.', flags: 1 << 6 });
            return;
        }

        // Role-based permission logic
        if (
            command.allowedRoles.length > 0 &&
            !command.allowedRoles.includes(CommandRole.Everyone)
        ) {
            const member = interaction.member as GuildMember;
            const roleNames = member.roles.cache.map(role => role.name);

            const roleMatch = command.allowedRoles.some(role => {
                switch (role) {
                    case CommandRole.BotAdmin:
                        return roleNames.includes(process.env.ADMIN_ROLE_NAME || 'BustinBot Admin');
                    case CommandRole.MovieAdmin:
                        return roleNames.includes(process.env.MOVIE_ADMIN_ROLE_NAME || 'Movie Admin');
                    case CommandRole.TaskAdmin:
                        return roleNames.includes(process.env.TASK_ADMIN_ROLE_NAME || 'Task Admin');
                    default:
                        return false;
                }
            });

            if (!roleMatch) {
                await interaction.reply({ content: "You don't have permission to use this command.", flags: 1 << 6 });
                return;
            }
        }

        try {
            await command.execute({ interaction });
        } catch (error) {
            console.error(`[Slash Command Error]: ${command.name}`, error);
            await interaction.reply({ content: 'There was an error executing that command.', flags: 1 << 6 });
        }
        return;
    }

    // Forward all non-slash interactions to task module
    try {
        await handleTaskInteraction(interaction, interaction.client);
    } catch (error) {
        console.error(`[Task Interaction Error]:`, error);
        if (interaction.isRepliable()) {
            await interaction.reply({ content: 'There was an error processing the task interaction.', flags: 1 << 6})
        }
    }
}