import { ButtonInteraction, ModalSubmitInteraction, ActionRowBuilder, Message, ButtonBuilder, ButtonStyle, EmbedBuilder, TextChannel, StringSelectMenuInteraction } from "discord.js";
import Fuse from 'fuse.js';
import type { Movie } from "../../models/Movie.js";
import type { MoviePoll } from "../../models/MoviePoll.js";
import type { PollSession } from "../../models/PollSession.js";
import { createMovieEmbed } from "./MovieEmbeds.js";
import { pickRandomMovie, buildMovieEmbedWithMeta } from "./MovieLocalSelector.js";
import { getManualPollSession, changeManualPollPage, clearManualPollSession, updateManualPollSelection, showMovieManualPollMenu } from "./MovieManualPoll.js";
import { pollMovieRandom, pollMovieWithList } from "./MoviePolls.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { notifyMovieSubmitter } from "./MovieLocalSelector.js";

export async function saveCurrentMovie(services: ServiceContainer, movie: Movie, selectedBy?: string) {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        console.error("[MovieStorage] Movie repository not found in services.");
        return;
    }
    try {
        const { addedByDisplay, addedByDevId, ...movieData } = movie;
        await movieRepo.upsertMovie({
            ...movieData,
            watched: false,
            selectedAt: new Date(),
            selectedBy,
        });
        console.log(`[MovieStorage] Saved current movie: ${movie.title}`);
    } catch (error) {
        console.error("[MovieStorage] Failed to save current movie:", error);
    }
}

function getPollSession(poll: MoviePoll): PollSession<Movie> {
    const voteCounts = new Map<string, number>();
    for (const movie of poll.options) {
        voteCounts.set(movie.id, 0);
    }

    Object.values(poll.votes).forEach(movieId => {
        if (voteCounts.has(movieId)) {
            voteCounts.set(movieId, voteCounts.get(movieId)! + 1);
        }
    });

    return {
        ...poll,
        optionVoteCounts: voteCounts,
    };
}

export async function handleMoviePickChooseModalSubmit(services: ServiceContainer, interaction: ModalSubmitInteraction) {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        await interaction.reply({
            content: "Movie repository unavailable.",
            flags: 1 << 6,
        });
        return;
    }

    const input = interaction.fields.getTextInputValue("movie_input").trim();
    const movies: Movie[] = await movieRepo.getAllMovies();

    if (!movies.length) {
        await interaction.reply({ content: "Movie list is empty.", flags: 1 << 6 });
        return;
    }

    let selectedMovie: Movie | undefined;

    // Case 1: Numeric input as index
    if (/^\d+$/.test(input)) {
        const index = parseInt(input) - 1;
        if (index >= 0 && index < movies.length) {
            selectedMovie = movies[index];
        }
    }

    // Case 2: Title fuzzy match using Fuse.js
    if (!selectedMovie) {
        const fuse = new Fuse(movies, {
            keys: ["title"],
            threshold: 0.4,
            includeScore: true,
        });

        const results = fuse.search(input);
        if (results.length) {
            selectedMovie = results[0]?.item;
        }
    }

    if (!selectedMovie) {
        await interaction.reply({ content: "No matching movie found.", flags: 1 << 6 });
        return;
    }

    await saveCurrentMovie(services, selectedMovie, interaction.user.id);
    await notifyMovieSubmitter(selectedMovie, interaction.client, services);

    const embed = createMovieEmbed(selectedMovie);
    const existingDescription = embed.data.description ?? "";
    const addedByLine = `\n\n*Added by <@${selectedMovie.addedBy}>*`;

    embed.setTitle(
        `🎯  ${selectedMovie.title} ${selectedMovie.releaseDate ? `(${selectedMovie.releaseDate})` : ""
        }`
    );
    embed.setDescription(`${existingDescription}${addedByLine}`);

    const channel = interaction.channel as TextChannel;
    await interaction.reply({
        content: `**${selectedMovie.title}** has been selected and posted!`,
        flags: 1 << 6,
    });

    await channel.send({
        content: `The following movie has been selected for movie night:`,
        embeds: [embed],
    });
}

export async function handleRandomPollCountSelect(services: ServiceContainer, interaction: StringSelectMenuInteraction) {
    const selectedCount = parseInt(interaction.values[0]!, 10);
    await interaction.deferUpdate();
    await pollMovieRandom(services, interaction, selectedCount);
}

export async function handleConfirmRandomMovie(services: ServiceContainer, interaction: ButtonInteraction) {
    const message = interaction.message as Message;
    const embed = message.embeds[0];
    const channel = interaction.channel as TextChannel;

    const parts = interaction.customId.split("_");
    const movieId = parts[3];
    if (!movieId) {
        await interaction.reply({ content: "Could not identify movie ID.", flags: 1 << 6 });
        return;
    }

    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        await interaction.reply({
            content: "Movie repository unavailable.",
            flags: 1 << 6,
        });
        return;
    }

    const movies = await movieRepo.getAllMovies();
    const selectedMovie = movies.find((m) => m.id === movieId);
    if (!selectedMovie) {
        await interaction.reply({
            content: "Could not find the selected movie in list.",
            flags: 1 << 6,
        });
        return;
    }

    await saveCurrentMovie(services, selectedMovie, interaction.user.id);
    await notifyMovieSubmitter(selectedMovie, interaction.client, services);

    if (!embed) {
        await channel.send({
            content: `🎉 Movie locked in (no embed found).`,
            components: [],
        });
        return;
    }

    await channel.send({
        content: `The following movie has been selected for movie night:`,
        embeds: [embed],
        components: [],
    });

    await interaction.deferUpdate();
    try {
        await interaction.editReply({
            content: "Movie selected and posted!",
            embeds: [],
            components: [],
        });
    } catch (error) {
        console.warn("[MovieConfirm] Failed to clean up ephemeral message:", error);
    }
}

export async function handleRerollRandomMovie(services: ServiceContainer, interaction: ButtonInteraction) {
    const newMovie = await pickRandomMovie(services);

    if (!newMovie) {
        await interaction.update({
            content: 'Failed to reroll: movie list is empty.',
            components: [],
            embeds: []
        });
        return;
    }

    const embed = await buildMovieEmbedWithMeta(newMovie, 'random');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirm_random_movie_${newMovie.id}`)
            .setLabel('🎥 Lock this in')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId('reroll_random_movie')
            .setLabel('🔁 Reroll')
            .setStyle(ButtonStyle.Danger)
    );

    await interaction.update({
        content: '🔁 New movie selected:',
        embeds: [embed],
        components: [row],
    });
}

export async function handleMoviePollVote(services: ServiceContainer, interaction: ButtonInteraction) {
    const movieRepo = services.repos.movieRepo;
    if (!movieRepo) {
        await interaction.reply({ content: "Movie repository unavailable.", flags: 1 << 6 });
        return;
    }

    const activePoll = await movieRepo.getActivePoll();
    if (!activePoll || !activePoll.isActive) {
        await interaction.reply({ content: "This poll is no longer active.", flags: 1 << 6 });
        return;
    }

    if (interaction.message.id !== activePoll.messageId) {
        await interaction.reply({ content: "This poll message is outdated.", flags: 1 << 6 });
        return;
    }

    const selectedIndex = parseInt(interaction.customId.replace("movie_vote_", ""), 10);
    const selectedMovie = activePoll.options[selectedIndex];
    if (!selectedMovie) {
        await interaction.reply({ content: "Invalid vote option.", flags: 1 << 6 });
        return;
    }

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: 1 << 6 });
    }

    const userId = interaction.user.id;

    let firstTime = false;
    let updatedPoll = activePoll;
    try {
        const result = await movieRepo.voteInPollOnce(activePoll.id, userId, selectedMovie.id);
        firstTime = result.firstTime;
        updatedPoll = result.updatedPoll;
    } catch (err) {
        console.error("[MoviePollVote] Failed to record vote transaction:", err);
        await interaction.editReply({ content: "An error occurred while recording your vote." });
        return;
    }

    if (firstTime) {
        const userRepo = services.repos.userRepo;
        if (userRepo) {
            try {
                await userRepo.incrementStat(userId, "moviePollsVoted", 1);
            } catch (err) {
                console.warn(`[Stats] Failed to increment moviePollsVoted for ${interaction.user.username}:`, err);
            }
        } else {
            console.warn("[Stats] UserRepo unavailable; skipping moviePollsVoted increment.");
        }
    }

    const pollSession = getPollSession(updatedPoll);
    const updatedEmbeds: EmbedBuilder[] = interaction.message.embeds.map((embedData, i) => {
        const embed = EmbedBuilder.from(embedData);
        const movie = updatedPoll.options[i]!;
        const count = pollSession.optionVoteCounts.get(movie.id) ?? 0;
        const runtimeText = movie.runtime ? ` | ⏱️ ${movie.runtime} mins` : "";
        embed.setFooter({
            text: `🗳️ ${count} vote${count !== 1 ? "s" : ""}${runtimeText} | Option ${i + 1}`,
        });
        return embed;
    });

    await (interaction.message as Message).edit({ embeds: updatedEmbeds });
    await interaction.editReply({ content: "Thank you for your vote!" });
}

export async function handleManualPollInteraction(services: ServiceContainer, interaction: ButtonInteraction) {
    const uid = interaction.user.id;

    switch (interaction.customId) {
        case 'movie_poll_manual_prev':
            changeManualPollPage(services, uid, -1);
            return showMovieManualPollMenu(services, interaction);
        case 'movie_poll_manual_next':
            changeManualPollPage(services, uid, 1);
            return showMovieManualPollMenu(services, interaction);
        case 'movie_poll_manual_cancel':
            clearManualPollSession(uid);
            return interaction.update({ content: 'Poll creation cancelled.', embeds: [], components: [], flags: 1 << 6 });
        case 'movie_poll_manual_confirm': {
            const session = getManualPollSession(uid);
            if (!session || session.selected.size < 2 || session.selected.size > 5) {
                return interaction.reply({ content: `You must select between 2 and 5 movies.`, flags: 1 << 6 });
            }

            const movieRepo = services.repos.movieRepo;
            if (!movieRepo) {
                await interaction.reply({
                    content: "Movie repository unavailable.",
                    flags: 1 << 6,
                });
                return;
            }

            const allMovies: Movie[] = await movieRepo.getAllMovies();
            const selectedMovieIds = Array.from(session.selected);
            const selectedMovies = allMovies.filter(m => selectedMovieIds.includes(m.id));

            clearManualPollSession(uid);

            return pollMovieWithList(services, interaction, selectedMovies);
        }
    }
}
