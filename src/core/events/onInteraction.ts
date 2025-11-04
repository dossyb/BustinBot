import { GuildMember } from 'discord.js';
import type { APIInteractionGuildMember, Interaction } from 'discord.js';
import type { Command } from '../../models/Command.js';
import { CommandModule, CommandRole } from '../../models/Command.js';
import type { ServiceContainer } from '../services/ServiceContainer.js';
import { setupService } from '../services/SetupService.js';
import { createTimezoneModal, timezoneService } from '../services/TimezoneService.js';

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

        const isSetupCommand = command.name === 'setup';
        const rawMember = interaction.member;

        if (!rawMember) {
            await interaction.reply({
                content: 'Unable to determine your server membership. Please try again from within the guild.',
                flags: 1 << 6,
            });
            return;
        }

        const guildMember = rawMember instanceof GuildMember ? rawMember : null;
        const apiMember = rawMember as APIInteractionGuildMember;

        const userRoleIds = guildMember
            ? guildMember.roles.cache.map((role) => role.id)
            : Array.isArray(apiMember.roles)
            ? apiMember.roles
            : [];

        const userRoleNames = guildMember
            ? guildMember.roles.cache.map((role) => role.name)
            : [];

        if (isSetupCommand) {
            const adminRoleName = "BustinBot Admin";

            const hasAdminRole =
                guildMember?.roles.cache.some(
                    (role) => role.name === adminRoleName || role.id === adminRoleName,
                ) ?? false;

            if (!hasAdminRole) {
                await interaction.reply({
                    content: `Only members with the **${adminRoleName}** role can run \`/setup\`. Please have a server admin create and assign this role first.`,
                    flags: 1 << 6,
                });
                return;
            }

            // Run setup freely, without Firestore dependency
            await command.execute({ interaction, services });
            return;
        }

        // Role-based permission logic
        if (
            command.allowedRoles.length > 0 &&
            !command.allowedRoles.includes(CommandRole.Everyone)
        ) {
            const guildConfig = await services.guilds.requireConfig(interaction);
            if (!guildConfig) return;

            const guildRoles = guildConfig!.roles ?? {};

            const hasRole = (configured?: string, fallbackEnv?: string) => {
                const value = configured ?? fallbackEnv;
                if (!value) return false;
                if (/^\d+$/.test(value)) {
                    return userRoleIds.includes(value);
                }
                return userRoleNames.includes(value);
            };

            const roleMatch = command.allowedRoles.some(role => {
                switch (role) {
                    case CommandRole.BotAdmin:
                        return hasRole(guildRoles.admin, process.env.ADMIN_ROLE_NAME);
                    case CommandRole.MovieAdmin:
                        return hasRole(guildRoles.movieAdmin, process.env.MOVIE_ADMIN_ROLE_NAME);
                    case CommandRole.TaskAdmin:
                        return hasRole(guildRoles.taskAdmin, process.env.TASK_ADMIN_ROLE_NAME);
                    default:
                        return false;
                }
            });

            if (!roleMatch) {
                await interaction.reply({ content: "You don't have permission to use this command.", flags: 1 << 6 });
                return;
            }
        }

        // Module setup validation
        const guildId = interaction.guildId!;
        const guildConfig = await services.guilds.get(guildId);
        const setupMap = guildConfig?.setupComplete ?? {} as any;

        const requiredModule = command.module;
        const moduleReady = setupMap[requiredModule];

        if (!setupMap.core && !isSetupCommand) {
            await interaction.reply({ content: 'The bot has not been set up yet. Please run `/setup` first to configure the core channels.', flags: 1 << 6 });
            return;
        }

        if (!moduleReady && !isSetupCommand) {
            let setupCommandHint = '';

            switch (requiredModule) {
                case CommandModule.Movie:
                    setupCommandHint = '`/moviesetup`';
                    break;
                case CommandModule.Task:
                    setupCommandHint = '`/tasksetup`';
                    break;
            }

            await interaction.reply({ content: `This command can't be used yet! An admin needs to run \`${setupCommandHint}\` to configure its required channels and roles first.`, flags: 1 << 6 });
            return;
        }

        try {
            const userRepo = services.repos.userRepo;
            if (userRepo) {
                try {
                    await userRepo.incrementStat(interaction.user.id, "commandsRun", 1);
                } catch (err) {
                    console.warn(`[Stats] Failed to increment commandsRun for ${interaction.user.username}:`, err);
                }
            } else {
                console.warn("[Stats] UserRepo unavailable; skipping commandsRun increment.");
            }
            await command.execute({ interaction, services });
        } catch (error) {
            console.error(`[Slash Command Error]: ${command.name}`, error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'There was an error executing that command.', flags: 1 << 6 });
            } else {
                await interaction.followUp({ content: 'There was an error executing that command.', flags: 1 << 6 });
            }
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

        if (customId === 'setup_timezone') {
            const modal = createTimezoneModal();
            await interaction.showModal(modal);
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

    if (interaction.isModalSubmit() && interaction.customId === 'setup_timezone_modal') {
        const input = interaction.fields.getTextInputValue("timezone_input").trim();

        const matchedZone = timezoneService.fuzzyMatch(input);

        if (!matchedZone) {
            await interaction.reply({
                content:
                    "Could not recognise that timezone. Please try again using an IANA name (e.g., `Australia/Melbourne`, `America/New_York`).", flags: 1 << 6,
            });
            return;
        }

        const guildId = interaction.guildId!;
        await services.guilds.update(guildId, { timezone: matchedZone });

        const currentTime = timezoneService.getCurrentTimeInZone(matchedZone);
        await interaction.reply({ content: `Timezone set to **${matchedZone}**.\nCurrent local time: **${currentTime}**`, flags: 1 << 6 });

        console.log(`[Setup] Timezone updated for ${guildId}: ${matchedZone}`);
    }
}
