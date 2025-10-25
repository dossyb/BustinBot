import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Message } from "discord.js";
import type { Command } from '../../../models/Command';
import { CommandModule, CommandRole } from "../../../models/Command";
import type { Movie } from "../../../models/Movie";
import { createMovieListEmbeds } from "../../movies/MovieEmbeds";
import type { ServiceContainer } from "../../../core/services/ServiceContainer";

const MOVIES_PER_PAGE = 3;

function paginateMovies(movies: Movie[], page: number): Movie[] {
    const start = page * MOVIES_PER_PAGE;
    return movies.slice(start, start + MOVIES_PER_PAGE);
}

function buildNavButtons(currentPage: number, totalPages: number) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('page_start')
            .setEmoji('⏮️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),

        new ButtonBuilder()
            .setCustomId('page_prev')
            .setEmoji('◀️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0),

        new ButtonBuilder()
            .setCustomId('page_next')
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage >= totalPages - 1),

        new ButtonBuilder()
            .setCustomId('page_end')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1),
    );
}

const listmovies: Command = {
    name: 'listmovies',
    description: 'Show the list of movies added for movie night.',
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('listmovies')
        .setDescription('View the current movie list with pagination.'),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        // Load movies from file
        const movieRepo = services.repos.movieRepo;
        if (!movieRepo) {
            await interaction.editReply("Movie repository not available.");
            return;
        }

        const toMillis = (value: unknown): number => {
            if (!value) return 0;
            if (value instanceof Date) return value.getTime();

            const maybeTimestamp = value as { toDate?: () => Date };
            if (maybeTimestamp && typeof maybeTimestamp.toDate === "function") {
                return maybeTimestamp.toDate().getTime();
            }

            if (typeof value === "number") return value;
            if (typeof value === "string") {
                const parsed = Date.parse(value);
                return Number.isNaN(parsed) ? 0 : parsed;
            }

            return 0;
        };

        const movies: Movie[] = await movieRepo.getAllMovies();
        const unwatchedMovies = movies
            .filter(movie => !movie.watched)
            .sort((a, b) => toMillis(a.addedAt) - toMillis(b.addedAt));
        
        if (!unwatchedMovies.length) {
            await interaction.editReply('No unwatched movies are currently queued. Add a new one with `/addmovie`!');
            return;
        }

        let currentPage = 0;
        const totalPages = Math.ceil(unwatchedMovies.length / MOVIES_PER_PAGE);

        const getPageEmbeds = (page: number) => {
            const pageMovies = paginateMovies(unwatchedMovies, page);
            return createMovieListEmbeds(pageMovies, page, MOVIES_PER_PAGE);
        }

        const components = [buildNavButtons(currentPage, totalPages)];
        const embeds = getPageEmbeds(currentPage);

        const reply = await interaction.editReply({
            embeds,
            components,
        }) as Message;

        const collector = reply.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 180000,
            filter: (btnInt) => btnInt.user.id === interaction.user.id,
        });

        collector.on('collect', async (btnInt) => {
            switch (btnInt.customId) {
                case 'page_start':
                    currentPage = 0;
                    break;
                case 'page_prev':
                    currentPage = Math.max(0, currentPage - 1);
                    break;
                case 'page_next':
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                    break;
                case 'page_end':
                    currentPage = totalPages - 1;
                    break;    
            }

            await btnInt.deferUpdate();

            const newEmbeds = await getPageEmbeds(currentPage);
            const newComponents = [buildNavButtons(currentPage, totalPages)];

            await interaction.editReply({
                embeds: newEmbeds,
                components: newComponents,
            });
        });

        collector.on('end', async () => {
            await interaction.editReply({ components: [] });
        });
    },
};

export default listmovies;