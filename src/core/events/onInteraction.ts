import { ChatInputCommandInteraction, GuildMember, ButtonInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import type { Interaction } from 'discord.js';
import type { Command, ServiceContainer } from '../../models/Command';
import { CommandRole } from '../../models/Command';
import { handleTaskInteraction } from '../../modules/tasks/TaskInteractions';
import { handleMoviePickChooseModalSubmit, handleConfirmRandomMovie, handleRerollRandomMovie } from '../../modules/movies/PickMovieInteractions';
import { showMovieManualPollMenu } from '../../modules/movies/MovieManualPoll';
import { handleMovieNightDate, handleMovieNightTime } from '../../modules/movies/MovieScheduler';
import type { TaskService } from '../../modules/tasks/TaskService';

export async function handleInteraction(
    interaction: Interaction,
    commands: Map<string, Command>,
    services: { botStats: any, tasks: TaskService }
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
        switch (interaction.customId) {
            case 'movie_pick_choose_modal':
                return handleMoviePickChooseModalSubmit(interaction);
        }

        if (interaction.customId.startsWith('movienight-time-')) {
            return handleMovieNightTime(interaction);
        }
    }

    if (interaction.isButton()) {
        const { customId } = interaction;
        const uid = interaction.user.id;

        if (customId.startsWith('confirm_random_movie')) {
            return handleConfirmRandomMovie(interaction);
        }
        if (customId === 'reroll_random_movie') {
            return handleRerollRandomMovie(interaction);
        }
        if (customId.startsWith('movie_vote_')) {
            const { handleMoviePollVote } = await import('../../modules/movies/PickMovieInteractions');
            return handleMoviePollVote(interaction);
        }

        if (customId.startsWith('movie_poll_manual_')) {
            const { handleManualPollInteraction } = await import('../../modules/movies/PickMovieInteractions');
            return handleManualPollInteraction(interaction);
        };
    }

    if (interaction.isStringSelectMenu()) {
        switch (interaction.customId) {
            case 'movie_poll_random_count': {
                const { handleRandomPollCountSelect } = await import('../../modules/movies/PickMovieInteractions');
                return handleRandomPollCountSelect(interaction);
            }
            case 'movie_poll_manual_select': {
                const { updateManualPollSelection } = await import('../../modules/movies/MovieManualPoll');
                updateManualPollSelection(interaction.user.id, interaction.values);
                return showMovieManualPollMenu(interaction);
            }
            case 'movienight-select-date':
                return handleMovieNightDate(interaction);
        }
    }


    // Forward all non-slash interactions to task module
    try {
        await handleTaskInteraction(interaction, interaction.client, services);
    } catch (error) {
        console.error(`[Task Interaction Error]:`, error);
        if (interaction.isRepliable()) {
            await interaction.reply({ content: 'There was an error processing the task interaction.', flags: 1 << 6 })
        }
    }
}