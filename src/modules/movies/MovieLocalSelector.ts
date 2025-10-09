import fs from 'fs';
import path from 'path';
import { EmbedBuilder } from 'discord.js';
import type { Movie } from '../../models/Movie';
import { createMovieEmbed } from './MovieEmbeds';
import { injectMockUsers, getDisplayNameFromAddedBy } from './MovieMockUtils';

const movieFilePath = path.resolve(process.cwd(), 'src/data/movies.json');

export async function pickRandomMovie(): Promise<Movie | null> {
    if (!fs.existsSync(movieFilePath)) return null;

    const rawData = fs.readFileSync(movieFilePath, 'utf-8');
    let movies: Movie[] = JSON.parse(rawData);
    movies = injectMockUsers(movies);
    if (!movies.length) return null;

    const index = Math.floor(Math.random() * movies.length);
    const randomMovie = movies[index];
    if (!randomMovie) return null;
    return randomMovie;
}

export async function buildMovieEmbedWithMeta(
    movie: Movie,
    style: 'random' | 'chosen' | 'preview' = 'random'
): Promise<EmbedBuilder> {
    const embed = createMovieEmbed(movie);
    const existingDescription = embed.data.description ?? '';
    const addedByText = getDisplayNameFromAddedBy(movie.addedBy);
    const addedByLine = `\n\n_Added by ${addedByText}_`;

    const titlePrefix =
        style === 'random' ? '🎲' :
        style === 'chosen' ? '🎯' :
        '🎥';

    embed.setTitle(`${titlePrefix} ${movie.title}`);
    embed.setDescription(`${existingDescription}${addedByLine}`);

    return embed;
}
