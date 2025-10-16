import { EmbedBuilder } from 'discord.js';
import type { Movie } from '../../models/Movie';
import { createMovieEmbed } from './MovieEmbeds';
import { injectMockUsers, getDisplayNameFromAddedBy } from './MovieMockUtils';
import type { ServiceContainer } from '../../core/services/ServiceContainer';

export async function pickRandomMovie(services: ServiceContainer): Promise<Movie | null> {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        console.error('[MovieLocalSelector] Movie repository not found in ServiceContainer.');
        return null;
    }

    try {
        let movies = await movieRepo.getAllMovies();
        movies = injectMockUsers(movies);
        if (!movies.length) return null;

        const index = Math.floor(Math.random() * movies.length);
        return movies[index] ?? null;
    } catch (error) {
        console.error('[MovieLocalSelector] Failed to fetch movies:', error);
        return null;
    }
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
