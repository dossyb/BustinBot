import { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, Client, time, TimestampStyles, MessageFlags } from "discord.js";
import type { RepliableInteraction } from "discord.js";
import { randomUUID } from "node:crypto";
import type { Movie } from "../../models/Movie.js";
import type { MoviePoll } from "../../models/MoviePoll.js";
import { injectMockUsers } from "./MovieMockUtils.js";
import { createLocalMoviePreviewEmbed } from "./MovieEmbeds.js";
import { saveCurrentMovie } from "./PickMovieInteractions.js";
import { DateTime } from "luxon";
import { countBy, sample, shuffle, uniqBy } from "es-toolkit";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { notifyMovieSubmitter } from "./MovieLocalSelector.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../utils/MentionUtils.js";
import { configuredChannel } from "../../utils/ChannelUtils.js";

const MAX_CHOICES = 5;
const emojiNumbers = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

async function createAndSendMoviePoll(
    services: ServiceContainer,
    interaction: RepliableInteraction,
    client: Client,
    movies: Movie[]
) {
    const movieRepo = services.repos.movieRepo;

    const activeMovies = movies.filter((movie) => !movie.watched);
    if (activeMovies.length < 2) {
        await interaction.editReply("Need at least 2 unwatched movies to create a poll.");
        return;
    }

    const guildConfig = await services.guilds.get(services.guildId);
    const guildRoles = guildConfig?.roles ?? {};
    const channel = guildConfig?.channels?.movieNight
        ? await configuredChannel(client, services, "movieNight")
        : interaction.channel;
    if (!channel?.isSendable()) {
        await interaction.editReply("Could not find the configured movie announcement channel. Please run `/moviesetup` again.");
        return;
    }

    const pollId = randomUUID();
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
        options: activeMovies,
        messageId: "",
        channelId: interaction.channelId,
        createdAt: now.toJSDate(),
        endsAt: endsAt.toJSDate(),
        isActive: true,
        votes: {},
    };

    const embeds: EmbedBuilder[] = activeMovies.map((movie, i) => {
        const embed = createLocalMoviePreviewEmbed(movie);
        const runtimeText = movie.runtime ? ` | ⏱️ ${movie.runtime} mins` : "";
        embed.setFooter({ text: `🗳️ 0 votes${runtimeText} | Option ${i + 1}` });
        return embed;
    });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        activeMovies.map((movie, i) => {
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
    const suppressMentions = await isMentionSuppressed(services.guilds, interaction.guildId);
    if (mention) {
        if (suppressMentions) {
            await channel.send(withSuppressedMentions({ content: mention }, true));
        } else {
            await channel.send(mention);
        }
    }
    const message = await channel.send({
        content: `📊 **Vote for the next movie night pick!**\nPoll ends ${time(pollCloseUnix, TimestampStyles.RelativeTime)} (${time(pollCloseUnix, TimestampStyles.LongDateTime)}).`,
        embeds,
        components: [row],
    });

    poll.messageId = message.id;
    poll.channelId = message.channelId;
    await movieRepo.createPoll(poll);
}

export async function pollMovieRandom(services: ServiceContainer, interaction: RepliableInteraction, count: number | null) {
    const movieRepo = services.repos.movieRepo;

    const client = interaction.client;
    let movies: Movie[] = await movieRepo.getAllMovies();
    movies = movies.filter((movie) => !movie.watched);
    movies = injectMockUsers(movies);

    if (!movies.length) {
        await interaction.editReply("The movie list is empty.");
        return;
    }

    const uniqueMovies = uniqBy(shuffle(movies), (movie) => movie.addedByDevId ?? movie.addedBy);

    const maxChoices = Math.min(5, uniqueMovies.length, count ?? 5);
    if (maxChoices < 2) {
        await interaction.editReply("Not enough unique contributors to start a fair poll.");
        return;
    }

    await createAndSendMoviePoll(services, interaction, client, uniqueMovies.slice(0, maxChoices));
}

export async function pollMovieWithList(services: ServiceContainer, interaction: RepliableInteraction, selected: Movie[]) {
    const client = interaction.client;
    const activeSelection = selected.filter((movie) => !movie.watched);

    if (activeSelection.length < 2 || activeSelection.length > MAX_CHOICES) {
        const msg = "You must select between 2 and 5 movies.";
        if (interaction.replied || interaction.deferred)
            await interaction.editReply(msg);
        else
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        return;
    }

    const moviesWithUsers = injectMockUsers(activeSelection);

    if (!interaction.deferred && !interaction.replied) {
        if (interaction.isButton()) {
            await interaction.deferUpdate();
        } else {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
    }

    await interaction.editReply({
        content: "Poll confirmed and posted!",
        embeds: [],
        components: [],
    });

    await createAndSendMoviePoll(services, interaction, client, moviesWithUsers);
}

export async function closeActiveMoviePoll(services: ServiceContainer, client: Client, closedBy: string): Promise<{ success: boolean; message: string; winner?: Movie, winningVotes?: number, tieBreak?: boolean }> {
    const movieRepo = services.repos.movieRepo;

    const openPoll = await movieRepo.getActivePoll();
    // Mark poll inactive and persist
    const activePoll = openPoll?.isActive ? await movieRepo.closePoll(openPoll.id) : null;
    if (!activePoll) {
        return { success: false, message: "No active poll found." };
    }

    const voteEntries = Object.entries(activePoll.votes ?? {});
    if (!voteEntries.length) {
        console.log(`[MoviePoll] Poll closed by ${closedBy}, but no votes were cast.`);
        return {
            success: true,
            message: "Poll closed. No votes were cast, so no winner was selected.",
        };
    }

    // Tally votes
    const voteCounts = countBy(voteEntries.map(([, movieId]) => movieId), (movieId) => movieId);

    const sorted = activePoll.options
        .map((option): [string, number] => [option.id, voteCounts[option.id] ?? 0])
        .sort((a, b) => b[1] - a[1]);
    const topEntry = sorted[0];
    if (!topEntry) {
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
        [winningId] = sample(tiedEntries);
        console.log(`[MoviePoll] Tie detected among ${tiedEntries.length} movies (${topVotes} votes each). Randomly selected one.`);
    }

    const winningMovie = activePoll.options.find((m) => m.id === winningId);
    if (!winningMovie) {
        return { success: false, message: "Could not find the winning movie in poll options." };
    }

    // Save the selected movie as current
    await saveCurrentMovie(services, winningMovie, closedBy);
    await notifyMovieSubmitter(winningMovie, client, services);

    const baseMessage = tieBreak
        ? `Poll closed successfully. After a tie with ${topVotes} votes, BustinBot chose ${winningMovie.title}.`
        : `Poll closed successfully. ${winningMovie.title} won with ${topVotes} votes.`;

    console.log(`[MoviePoll] Poll closed by ${closedBy}. Winner: ${winningMovie.title}${tieBreak ? " (tie-breaker)" : ""}`);

    // Update the poll message to show it's closed and disable buttons
    try {
        if (activePoll.messageId && activePoll.channelId) {
            const channel = await client.channels.fetch(activePoll.channelId);
            if (channel?.isTextBased()) {
                const message = await channel.messages.fetch(activePoll.messageId);
                const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    activePoll.options.map((movie, i) => {
                        const truncatedTitle = movie.title.length > 20 ? movie.title.slice(0, 17) + "…" : movie.title;
                        const emojiNumbers = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
                        const label = `${emojiNumbers[i]} ${truncatedTitle}`;
                        return new ButtonBuilder()
                            .setCustomId(`movie_vote_${i}_disabled`)
                            .setLabel(label)
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true);
                    })
                );
                await message.edit({
                    content: `📊 **Vote for the next movie night pick!**\n~~Poll ended~~ - **${winningMovie.title}** was selected!`,
                    embeds: message.embeds,
                    components: [disabledRow],
                });
            }
        }
    } catch (error) {
        console.error("[MoviePoll] Failed to update poll message:", error);
    }

    return {
        success: true,
        message: baseMessage,
        winner: winningMovie,
        winningVotes: topVotes,
        tieBreak,
    };
}
