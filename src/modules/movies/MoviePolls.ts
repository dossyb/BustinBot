import { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, Message, TextChannel, Client } from "discord.js";
import type { RepliableInteraction } from "discord.js";
import { v4 as uuidv4 } from "uuid";
import type { Movie } from "../../models/Movie";
import type { MoviePoll } from "../../models/MoviePoll";
import { injectMockUsers } from "./MovieMockUtils";
import { createLocalMoviePreviewEmbed } from "./MovieEmbeds";
import { saveCurrentMovie } from "./PickMovieInteractions";
import { DateTime } from "luxon";
import { scheduleActivePollClosure } from "./MoviePollScheduler";
import type { ServiceContainer } from "../../core/services/ServiceContainer";
import { notifyMovieSubmitter } from "./MovieLocalSelector";

const MAX_CHOICES = 5;
const emojiNumbers = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

async function createAndSendMoviePoll(
    services: ServiceContainer,
    interaction: RepliableInteraction,
    client: Client,
    movies: Movie[]
) {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        console.error("[MoviePoll] Movie repository not found in services.");
        return;
    }

    const guildConfig = await services.guilds.requireConfig(interaction);
    if (!guildConfig) return;

    const guild = await client.guilds.fetch(interaction.guildId!);
    const guildRoles = guildConfig.roles ?? {};
    const guildChannels = guildConfig.channels ?? {};

    const targetChannelId = guildChannels.movieNight || interaction.channelId;
    if (!targetChannelId) return;
    const fetchedChannel = await guild.channels.fetch(targetChannelId).catch(() => null);
    const channel = fetchedChannel as TextChannel | null;
    if (!channel) {
        await interaction.reply({
            content:
                "Could not find the configured movie announcement channel. Please run `/moviesetup` again.", flags: 1 << 6,
        });
        return;
    }

    const pollId = uuidv4();
    const now = DateTime.utc();
    let endsAt = now.plus({ hours: 24 });

    // Adjust poll close time if movie night already scheduled
    const latestEvent = await movieRepo.getActiveEvent();
    if (latestEvent?.startTime) {
        const movieStart = DateTime.fromJSDate(latestEvent.startTime);
        if (movieStart.isValid) {
            const oneHourBefore = movieStart.minus({ hours: 1 });
            if (oneHourBefore < endsAt) {
                endsAt = oneHourBefore;
                console.log(`[MoviePoll] Adjusted poll close time to 1 hour before movie night (${oneHourBefore.toISO()})`);
            }
        }
    }

    const poll: MoviePoll = {
        id: pollId,
        type: "movie",
        options: movies,
        messageId: "",
        channelId: interaction.channelId,
        createdAt: now.toJSDate(),
        endsAt: endsAt.toJSDate(),
        isActive: true,
        votes: {},
    };

    const embeds: EmbedBuilder[] = movies.map((movie, i) => {
        const embed = createLocalMoviePreviewEmbed(movie);
        const runtimeText = movie.runtime ? ` | ⏱️ ${movie.runtime} mins` : "";
        embed.setFooter({ text: `🗳️ 0 votes${runtimeText} | Option ${i + 1}` });
        return embed;
    });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        movies.map((movie, i) => {
            const truncatedTitle = movie.title.length > 20 ? movie.title.slice(0, 17) + "…" : movie.title;
            const label = `${emojiNumbers[i]} ${truncatedTitle}`;

            return new ButtonBuilder()
                .setCustomId(`movie_vote_${i}`)
                .setLabel(label)
                .setStyle(ButtonStyle.Secondary);
        })
    );

    // Mention movie role if exists
    let mention = "";

    if (guildRoles.movieUser){
        mention = `<@&${guildRoles.movieUser}>`;
    }

    const pollCloseUnix = Math.floor(endsAt.toSeconds());
    if (mention) await channel.send(mention);
    const message = (await channel.send({
        content: `📊 **Vote for the next movie night pick!**\nPoll ends <t:${pollCloseUnix}:R> (<t:${pollCloseUnix}:F>).`,
        embeds,
        components: [row],
    })) as Message;

    poll.messageId = message.id;
    await movieRepo.createPoll(poll);

    await scheduleActivePollClosure(services, client);
}

export async function pollMovieRandom(services: ServiceContainer, interaction: RepliableInteraction, count: number | null) {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        await interaction.editReply("Movie repository not available.");
        return;
    }

    const client = interaction.client;
    let movies: Movie[] = await movieRepo.getAllMovies();
    movies = injectMockUsers(movies);

    if (!movies.length) {
        await interaction.editReply("The movie list is empty.");
        return;
    }

    const userMovieMap = new Map<string, Movie[]>();
    for (const movie of movies) {
        const contributorKey = movie.addedByDevId ?? movie.addedBy;
        if (!userMovieMap.has(contributorKey)) userMovieMap.set(contributorKey, []);
        userMovieMap.get(contributorKey)!.push(movie);
    }

    const uniqueMovies: Movie[] = [];
    for (const [, userMovies] of userMovieMap.entries()) {
        const randomIndex = Math.floor(Math.random() * userMovies.length);
        uniqueMovies.push(userMovies[randomIndex]!);
    }

    const maxChoices = Math.min(5, uniqueMovies.length, count ?? 5);
    if (maxChoices < 2) {
        await interaction.editReply("Not enough unique contributors to start a fair poll.");
        return;
    }

    const selected = uniqueMovies.sort(() => Math.random() - 0.5).slice(0, maxChoices);
    await createAndSendMoviePoll(services, interaction, client, selected);
}

export async function pollMovieWithList(services: ServiceContainer, interaction: RepliableInteraction, selected: Movie[]) {
    const client = interaction.client;

    if (selected.length < 2 || selected.length > MAX_CHOICES) {
        const msg = "You must select between 2 and 5 movies.";
        if (interaction.replied || interaction.deferred)
            await interaction.editReply(msg);
        else
            await interaction.reply({ content: msg, flags: 1 << 6 });
        return;
    }

    const moviesWithUsers = injectMockUsers(selected);

    if (!interaction.deferred && !interaction.replied) {
        if (interaction.isButton()) {
            await interaction.deferUpdate();
        } else {
            await interaction.deferReply({ flags: 1 << 6 });
        }
    }

    await interaction.editReply({
        content: 'Poll confirmed and posted!',
        embeds: [],
        components: [],
    });

    await createAndSendMoviePoll(services, interaction, client, moviesWithUsers);
}

export async function closeActiveMoviePoll(services: ServiceContainer, client: Client, closedBy: string): Promise<{ success: boolean; message: string; winner?: Movie, winningVotes?: number, tieBreak?: boolean }> {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        return { success: false, message: "Movie repository unavailable." };
    }

    const activePoll = await movieRepo.getActivePoll();
    if (!activePoll || !activePoll.isActive) {
        return { success: false, message: "No active poll found." };
    }

    const voteEntries = Object.entries(activePoll.votes ?? {});
    if (!voteEntries.length) {
        await movieRepo.closePoll(activePoll.id);
        console.log(`[MoviePoll] Poll closed by ${closedBy}, but no votes were cast.`);
        return {
            success: true,
            message: "Poll closed. No votes were cast, so no winner was selected.",
        };
    }

    // Tally votes
    const voteCounts = new Map<string, number>();
    for (const option of activePoll.options) voteCounts.set(option.id, 0);

    voteEntries.forEach(([, movieId]) => {
        if (voteCounts.has(movieId))
            voteCounts.set(movieId, (voteCounts.get(movieId) ?? 0) + 1);
    });

    const sorted = [...voteCounts.entries()].sort((a, b) => b[1] - a[1]);
    const topEntry = sorted[0];
    if (!topEntry) {
        await movieRepo.closePoll(activePoll.id);
        return {
            success: true,
            message: "Poll closed. Votes could not be tallied, so no winner was selected.",
        };
    }

    const [topMovieId, topVotes] = topEntry;
    const tiedEntries = sorted.filter(([_, votes]) => votes === topVotes);

    let winningId = topMovieId;
    let tieBreak = false;
    if (tiedEntries.length > 1) {
        tieBreak = true;
        const randomIndex = Math.floor(Math.random() * tiedEntries.length);
        winningId = tiedEntries[randomIndex]![0];
        console.log(`[MoviePoll] Tie detected among ${tiedEntries.length} movies (${topVotes} votes each). Randomly selected one.`);
    }

    const winningMovie = activePoll.options.find((m) => m.id === winningId);
    if (!winningMovie) {
        return { success: false, message: "Could not find the winning movie in poll options." };
    }

    // Mark poll inactive and persist
    await movieRepo.closePoll(activePoll.id);

    // Save the selected movie as current
    await saveCurrentMovie(services, winningMovie, closedBy);
    await notifyMovieSubmitter(winningMovie, client, services);

    const baseMessage = tieBreak
        ? `Poll closed successfully. After a tie with ${topVotes} votes, BustinBot chose ${winningMovie.title}.`
        : `Poll closed successfully. ${winningMovie.title} won with ${topVotes} votes.`;

    console.log(`[MoviePoll] Poll closed by ${closedBy}. Winner: ${winningMovie.title}${tieBreak ? " (tie-breaker)" : ""}`);

    return {
        success: true,
        message: baseMessage,
        winner: winningMovie,
        winningVotes: topVotes,
        tieBreak,
    };
}
