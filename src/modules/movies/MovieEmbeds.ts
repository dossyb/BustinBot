import { EmbedBuilder } from 'discord.js';
import type { Movie } from '../../models/Movie';

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
