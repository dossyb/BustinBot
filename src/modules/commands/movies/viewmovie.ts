import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import type { Command } from '../../../models/Command';
import { CommandRole } from '../../../models/Command';
import { createMovieEmbed } from '../../movies/MovieEmbeds';
import type { Movie } from '../../../models/Movie';

const movieFilePath = path.resolve(process.cwd(), 'src/data/movies.json');

const viewmovie: Command = {
    name: 'viewmovie',
    description: 'View details of a movie in the watchlist.',
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('viewmovie')
        .setDescription('View a movie from the local movie list.')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Name of the movie.')
                .setRequired(true)
        ),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const titleQuery = interaction.options.getString('title', true);

        if (!fs.existsSync(movieFilePath)) {
            await interaction.editReply("No movie list found.");
            return;
        }

        const movies: Movie[] = JSON.parse(fs.readFileSync(movieFilePath, 'utf-8'));

        const fuse = new Fuse(movies, {
            keys: ['title'],
            threshold: 0.4,
        });

        const results = fuse.search(titleQuery);
        if (results.length === 0) {
            await interaction.editReply(`No matching movie found for **${titleQuery}**.`);
            return;
        }

        const matchedMovie = results[0]!.item;

        let description = matchedMovie.overview ?? "No description available.";
        description += `\n\n_Added by <@${matchedMovie.addedBy ?? 'unknown'}>_`;

        const embed = createMovieEmbed(matchedMovie)
            .setTitle(`🎬 ${matchedMovie.title}`)
            .setDescription(description);

        await interaction.editReply({ embeds: [embed] });
    }
};

export default viewmovie;
