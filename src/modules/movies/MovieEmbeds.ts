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

export function createMovieNightEmbed(
    movie: Partial<Movie> | null,
    unixTimestamp: number,
    stateMessage: string,
    scheduledBy: string
): EmbedBuilder {
    let embed: EmbedBuilder;

    if (movie) {
        const titleText = `Now showing: ${movie.title}${movie.releaseDate ? ` (${movie.releaseDate})` : ''}`;

        // Conditionally append the "Added by" line
        let description = movie.overview || "No description available.";
        if (movie.addedBy) {
            const addedByText = getDisplayNameFromAddedBy(movie.addedBy);
            description += `\n\n_Added by ${addedByText}_`;
        }

        embed = createMovieEmbed(movie)
            .setTitle(titleText)
            .setDescription(description)
            .setColor(0xE91E63)
            .addFields(
                {
                    name: '🎥 Start Time',
                    value: `<t:${unixTimestamp}:F> (<t:${unixTimestamp}:R>)`,
                    inline: false,
                }
            )
            .setFooter({ text: `Scheduled by ${scheduledBy} • Powered by TMDb` });
    } else {
        // Fallback if no movie is locked in yet
        embed = new EmbedBuilder()
            .setTitle('🎞️ Upcoming Movie Night!')
            .setDescription(
                `<t:${unixTimestamp}:F> (<t:${unixTimestamp}:R>)\n\n${stateMessage}`
            )
            .setColor(0xE91E63)
            .setFooter({ text: `Scheduled by ${scheduledBy}` });
    }
    return embed;
}

export function createMoviePollClosedEmbed(
    movie: Movie,
    closedBy: string,
    winningVotes: number,
    tieBreak = false
): EmbedBuilder {
    const titleText = `🏆 Movie poll closed!`;
    const release = movie.releaseDate ? ` (${movie.releaseDate})` : "";

    let description = `The poll has concluded, and the winner is:\n\n**${movie.title}${release}**\n\n`;

    if (movie.addedBy) {
        const addedByText = getDisplayNameFromAddedBy(movie.addedBy);
        description += `_Added by ${addedByText}_\n\n`;
    }

    description += `Received **${winningVotes}** vote${winningVotes !== 1 ? "s" : ""}. `;

    if (tieBreak) {
        description += `*It was a tie! BustinBot made the final call.*`;
    }

    description += `\n\nThis movie is now set as the next movie for movie night.`;

    return new EmbedBuilder()
        .setTitle(titleText)
        .setDescription(description)
        .setThumbnail(movie.posterUrl ?? null)
        .setColor(0xE91E63)
        .setFooter({ text: `Closed by ${closedBy} • Powered by TMDb` })
        .setTimestamp();
}