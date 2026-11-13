import { EmbedBuilder, time, TimestampStyles } from "discord.js";
import { truncate } from "../../utils/TextUtils.js";
import type { Movie } from "../../models/Movie.js";
import type { TMDbSearchResult } from "./MovieService.js";
import { getDisplayNameFromAddedBy } from "./MovieMockUtils.js";

function titleWithRelease(movie: Partial<Movie>): string {
    return `${movie.title}${movie.releaseDate ? ` (${movie.releaseDate})` : ""}`;
}

function addedByLine(movie: Movie): string {
    return `\n\n*Added by ${getDisplayNameFromAddedBy(movie.addedBy, movie.addedByDisplay)}*`;
}

export function createMovieEmbed(movie: Partial<Movie>): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle(titleWithRelease(movie))
        .setDescription(movie.overview || "No description available.")
        .setThumbnail(movie.posterUrl || null)
        .addFields(
            { name: "Runtime", value: movie.runtime ? `${movie.runtime} mins` : "Unknown", inline: true },
            { name: "Director", value: movie.director ?? "Unknown", inline: true },
            { name: "Rating", value: movie.rating ? `${movie.rating}/10` : "Unrated", inline: true },
            { name: "Genres", value: movie.genres?.join(", ") || "Unknown", inline: true },
            { name: "Starring", value: movie.cast?.join(", ") || "Unknown", inline: true },
        )
        .setURL(movie.infoUrl || "https://www.themoviedb.org/")
        .setFooter({ text: "Powered by TMDb " });
}

export function createMoviePreviewEmbeds(results: TMDbSearchResult[]): EmbedBuilder[] {
    return results.map((movie, index) => {
        const title = `${movie.title} (${movie.release_date?.slice(0, 4) || "N/A"})`;

        return new EmbedBuilder()
            .setTitle(title)
            .setDescription(truncate(movie.overview || "No description available.", 200))
            .setThumbnail(movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null)
            .setFooter({ text: `Press button ${index + 1} to select this movie.` });
    });
}

export function createMovieListEmbeds(movies: Movie[], page: number, perPage = 3): EmbedBuilder[] {
    return movies.map((movie, i) => {
        const index = page * perPage + i + 1;
        return new EmbedBuilder()
            .setTitle(`${index}. ${titleWithRelease(movie)}`)
            .setDescription(truncate(movie.overview || "No description available.", 200) + addedByLine(movie))
            .setThumbnail(movie.posterUrl || null)
            .setURL(movie.infoUrl || "https://www.themoviedb.org/");
    });
}

export function createLocalMoviePreviewEmbed(movie: Movie): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle(titleWithRelease(movie))
        .setDescription(truncate(movie.overview || "No description available.", 130) + addedByLine(movie))
        .setThumbnail(movie.posterUrl ?? null)
        .setURL(movie.infoUrl || "https://www.themoviedb.org/");
}

export function createMovieNightEmbed(
    movie: Partial<Movie> | null,
    startTime: Date,
    stateMessage: string,
    scheduledBy: string
): EmbedBuilder {
    const startTimeValue = [
        `${time(startTime, TimestampStyles.LongDateTime)} (${time(startTime, TimestampStyles.RelativeTime)})`,
        stateMessage.trim()
    ].filter(Boolean).join("\n\n");

    if (!movie) {
        // No movie selected yet
        return new EmbedBuilder()
            .setTitle("🎞️ Upcoming Movie Night!")
            .setDescription(startTimeValue)
            .setColor(0xE91E63)
            .setFooter({ text: `Scheduled by ${scheduledBy}` });
    }

    // Build the base description
    const overview = movie.overview || "No description available.";
    // Add "Added by" line if applicable
    const addedBy = movie.addedBy
        ? `\n\n_Added by ${getDisplayNameFromAddedBy(movie.addedBy, movie.addedByDisplay)}_`
        : "";

    return createMovieEmbed(movie)
        .setTitle(`Now showing: ${titleWithRelease(movie)}`)
        .setDescription(overview + addedBy)
        .setColor(0xE91E63)
        .addFields({
            name: "🎥 Start Time",
            value: startTimeValue,
            inline: false,
        })
        .setFooter({ text: `Scheduled by ${scheduledBy} • Powered by TMDb` });
}

export function createMoviePollClosedEmbed(
    movie: Movie,
    closedBy: string,
    winningVotes: number,
    tieBreak = false
): EmbedBuilder {
    const titleText = `🏆 Movie poll closed!`;
    let description = `The poll has concluded, and the winner is:\n\n**${titleWithRelease(movie)}**\n\n`;

    if (movie.addedBy) {
        const addedByText = getDisplayNameFromAddedBy(movie.addedBy, movie.addedByDisplay);
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
