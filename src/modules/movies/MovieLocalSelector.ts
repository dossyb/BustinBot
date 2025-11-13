import { Client, EmbedBuilder } from 'discord.js';
import type { Movie } from '../../models/Movie.js';
import { createMovieEmbed } from './MovieEmbeds.js';
import { injectMockUsers, getDisplayNameFromAddedBy } from './MovieMockUtils.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';

export async function resolveGuildContext(client: Client, services: ServiceContainer): Promise<{ guildId: string | null; guildName: string; }> {
    let guildId: string | undefined = services.guildId;

    if (!guildId) {
        const guilds = await services.guilds.getAll();
        guildId = guilds[0]?.id;
    }

    if (!guildId) {
        return { guildId: null, guildName: 'this server' };
    }

    try {
        const guild = await client.guilds.fetch(guildId);
        return { guildId, guildName: guild.name };
    } catch (err) {
        console.warn(`[MovieGuildContext] Failed to resolve guild ${guildId}:`, err);
        return { guildId, guildName: 'this server' };
    }
}

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
    const addedByText = getDisplayNameFromAddedBy(movie.addedBy, movie.addedByDisplay);
    const addedByLine = `\n\n*Added by ${addedByText}*`;

    const titlePrefix =
        style === 'random' ? '🎲' :
            style === 'chosen' ? '🎯' :
                '🎥';

    embed.setTitle(`${titlePrefix} ${movie.title}`);
    embed.setDescription(`${existingDescription}${addedByLine}`);

    return embed;
}


export async function notifyMovieSubmitter(selectedMovie: Movie, client: Client, services: ServiceContainer) {
    if (!selectedMovie.addedBy) return;
    const { guildName } = await resolveGuildContext(client, services);

    try {
        const user = await client.users.fetch(selectedMovie.addedBy);
        if (!user) return;

        const message = `Hey <@${selectedMovie.addedBy}>! Your movie **${selectedMovie.title}** has been chosen for the next movie night in **${guildName}**. Check the movie night channel for session time details so you don't miss it!`;

        await user.send(message);
        console.log(`[MovieNotify] Sent DM to ${user.tag} for selected movie: ${selectedMovie.title}`);
    } catch (err) {
        console.warn(`[MovieNotify] Failed to DM user ${selectedMovie.addedBy}:`, err);
    }
}
