import { GuildMember } from 'discord.js';
import type { Interaction } from 'discord.js';
import type { Command } from '../../models/Command';
import { CommandRole } from '../../models/Command';
import type { ServiceContainer } from '../services/ServiceContainer';
import { setupService } from '../services/SetupService';

export async function handleInteraction(
    interaction: Interaction,
    commands: Map<string, Command>,
    services: ServiceContainer
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
            await command.execute({ interaction, services });
        } catch (error) {
            console.error(`[Slash Command Error]: ${command.name}`, error);
            await interaction.reply({ content: 'There was an error executing that command.', flags: 1 << 6 });
        }
        return;
    }

    if (interaction.isButton()) {
        const { customId } = interaction;
        const userId = interaction.user.id;

        if (customId === 'setup_confirm') {
            const selections = setupService.getSelections('core', userId);
            const missing = setupService.getMissingFields('core', selections);
            if (missing.length) {
                await interaction.reply({ content: `Please select: ${missing.join(', ')}`, flags: 1 << 6 });
                return;
            }

            await setupService.persist('core', services.guilds, interaction.guildId!, selections!);
            setupService.clearSelections('core', userId);

            await interaction.update({ content: 'Setup complete! Your general bot channels have been updated. To set up channels and roles for the movie and task modules, use `/moviesetup` and `/tasksetup` respectively.', components: [] });
            return;
        }

        if (customId === 'setup_cancel') {
            setupService.clearSelections('core', userId);
            await interaction.update({ content: 'Setup cancelled. No changes were made.', components: [] });
            return;
        }
    }

    if (interaction.isChannelSelectMenu()) {
        const userId = interaction.user.id;
        const channelId = interaction.values[0];
        if (!channelId) {
            await interaction.reply({ content: 'No channel selected.', flags: 1 << 6 });
            return;
        }

        switch (interaction.customId) {
            case 'setup_announce':
                setupService.setSelection('core', userId, 'announcements', channelId);
                break;
            case 'setup_log':
                setupService.setSelection('core', userId, 'botLog', channelId);
                break;
            case 'setup_archive':
                setupService.setSelection('core', userId, 'botArchive', channelId);
                break;
            default:
                return;
        }

        await interaction.deferUpdate();
    }
}
