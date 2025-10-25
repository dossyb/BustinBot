import { ChatInputCommandInteraction, GuildMember, ButtonInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import type { Interaction } from 'discord.js';
import type { Command } from '../../models/Command';
import { CommandRole } from '../../models/Command';
import { handleMoviePickChooseModalSubmit, handleConfirmRandomMovie, handleRerollRandomMovie } from '../../modules/movies/PickMovieInteractions';
import { showMovieManualPollMenu } from '../../modules/movies/MovieManualPoll';
import { handleMovieNightDate, handleMovieNightTime } from '../../modules/movies/MovieScheduler';
import type { ServiceContainer } from '../services/ServiceContainer';

const setupSelections = new Map<string, Record<string, string>>();

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

    // Route ModalSubmit interactions
    if (interaction.isModalSubmit()) {
        const { customId } = interaction;
        switch (true) {
            case customId === 'movie_pick_choose_modal':
                return handleMoviePickChooseModalSubmit(services, interaction);

            case customId.startsWith('movienight-time-'):
                return handleMovieNightTime(interaction, services);
        }
    }

    if (interaction.isButton()) {
        const { customId } = interaction;
        const userId = interaction.user.id;
        const selections = setupSelections.get(userId);

        if (customId.startsWith('confirm_random_movie')) {
            return handleConfirmRandomMovie(services, interaction);
        }
        if (customId === 'reroll_random_movie') {
            return handleRerollRandomMovie(services, interaction);
        }
        if (customId.startsWith('movie_vote_')) {
            const { handleMoviePollVote } = await import('../../modules/movies/PickMovieInteractions');
            return handleMoviePollVote(services, interaction);
        }

        if (customId.startsWith('movie_poll_manual_')) {
            const { handleManualPollInteraction } = await import('../../modules/movies/PickMovieInteractions');
            return handleManualPollInteraction(services, interaction);
        };

        if (customId === 'setup_confirm') {
            if (!selections) {
                await interaction.reply({ content: 'Please select all channels before confirming.', flags: 1 << 6 });
                return;
            }

            await services.guilds.update(interaction.guildId!, {
                channels: selections, setupComplete: true,
            });

            setupSelections.delete(userId);

            await interaction.update({ content: 'Setup complete! Your general bot channels have been updated. To set up channels and roles for the movie and task modules, use `/moviesetup` and `/tasksetup` respectively.', components: [] });
            return;
        }

        if (customId === 'setup_cancel') {
            setupSelections.delete(userId);
            await interaction.update({ content: 'Setup cancelled. No changes were made.', components: [] });
            return;
        }
    }

    if (interaction.isStringSelectMenu()) {
        switch (interaction.customId) {
            case 'movie_poll_random_count': {
                const { handleRandomPollCountSelect } = await import('../../modules/movies/PickMovieInteractions');
                return handleRandomPollCountSelect(services, interaction);
            }
            case 'movie_poll_manual_select': {
                const { updateManualPollSelection } = await import('../../modules/movies/MovieManualPoll');
                updateManualPollSelection(interaction.user.id, interaction.values);
                return showMovieManualPollMenu(services, interaction);
            }
            case 'movienight-select-date':
                return handleMovieNightDate(interaction, services);
        }
    }

    if (interaction.isChannelSelectMenu()) {
        const userId = interaction.user.id;
        const selections = setupSelections.get(userId) ?? {} as Record<string, string>;

        const channelId = interaction.values[0];
        if (!channelId) {
            await interaction.reply({ content: 'No channel selected.', flags: 1 << 6 });
            return;
        }

        switch (interaction.customId) {
            case 'setup_announce':
                selections.announcements = channelId;
                break;
            case 'setup_log':
                selections.botLog = channelId;
                break;
            case 'setup_archive':
                selections.botArchive = channelId;
                break;
        }

        setupSelections.set(userId, selections);

        await interaction.deferUpdate();
    }
}