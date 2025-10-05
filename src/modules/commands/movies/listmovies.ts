import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Message } from "discord.js";
import fs from 'fs';
import path from 'path';
import type { Command } from '../../../models/Command';
import { CommandRole } from "../../../models/Command";
import type { Movie } from "../../../models/Movie";
import { createMovieEmbed, createMovieListEmbeds } from "../../movies/MovieEmbeds";

const movieFilePath = path.resolve(process.cwd(), 'src/data/movies.json');
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
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('listmovies')
        .setDescription('View the current movie list with pagination.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;
        await interaction.deferReply();

        // Load movies from file
        if (!fs.existsSync(movieFilePath)) {
            await interaction.editReply('No movies found.');
            return;
        }

        const rawData = fs.readFileSync(movieFilePath, 'utf-8');
        const movies: Movie[] = JSON.parse(rawData);

        if (!movies.length) {
            await interaction.editReply('The movie list is currently empty.');
            return;
        }

        let currentPage = 0;
        const totalPages = Math.ceil(movies.length / MOVIES_PER_PAGE);

        const getPageEmbeds = (page: number) => {
            const pageMovies = paginateMovies(movies, page);
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