import { EmbedBuilder } from 'discord.js';
import type { Movie } from '../../models/Movie';
import { getDisplayNameFromAddedBy } from './MovieMockUtils';

function truncate(text: string, length = 200): string {
    return text.length > length ? text.slice(0, length - 3) + '...' : text;
}

export function createMovieEmbed(movie: Partial<Movie>): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle(`${movie.title} ${movie.releaseDate ? `(${movie.releaseDate})` : ''}`)
        .setDescription(movie.overview || 'No description available.')
        .setThumbnail(movie.posterUrl || null)
        .addFields(
            { name: 'Runtime', value: movie.runtime ? `${movie.runtime} mins` : 'Unknown', inline: true },
            { name: 'Rating', value: movie.rating ? `${movie.rating}/10` : 'Unrated', inline: true },
            { name: 'Genres', value: movie.genres?.join(', ') || 'Unknown', inline: false },
        )
        .setURL(movie.infoUrl || 'https://www.themoviedb.org/')
        .setFooter({ text: 'Powered by TMDb ' });

    return embed;
}

export function createMoviePreviewEmbeds(results: any[]): EmbedBuilder[] {
    return results.map((movie, index) => {
        const title = `${movie.title} (${movie.release_date?.slice(0, 4) || 'N/A'})`;

        return new EmbedBuilder()
            .setTitle(title)
            .setDescription(truncate(movie.overview || 'No description available.', 200))
            .setThumbnail(movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null)
            .setFooter({ text: `Press button ${index + 1} to select this movie.` });
    });
}

export function createMovieListEmbeds(movies: Movie[], page: number, perPage = 3): EmbedBuilder[] {
    return movies.map((movie, i) => {
        const index = page * perPage + i + 1;
        const title = `${index}. ${movie.title}${movie.releaseDate ? ` (${movie.releaseDate})` : ''}`;
        const addedByText = getDisplayNameFromAddedBy(movie.addedBy);
        const addedByLine = `\n\n_Added by ${addedByText}_`;

        return new EmbedBuilder()
            .setTitle(title)
            .setDescription(truncate(movie.overview || 'No description available.', 200) + addedByLine)
            .setThumbnail(movie.posterUrl || null)
            .setURL(movie.infoUrl || 'https://www.themoviedb.org/');
    });
}

export function createLocalMoviePreviewEmbed(movie: Movie): EmbedBuilder {
    const title = `${movie.title}${movie.releaseDate ? ` (${movie.releaseDate})` : ''}`;
    const addedByText = getDisplayNameFromAddedBy(movie.addedBy);
    const addedByLine = `\n\n_Added by ${addedByText}_`;

    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(truncate(movie.overview || 'No description available.', 130) + addedByLine)
        .setThumbnail(movie.posterUrl ?? null)
        .setURL(movie.infoUrl || 'https://www.themoviedb.org/');
}