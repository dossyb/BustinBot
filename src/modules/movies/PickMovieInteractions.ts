import { ButtonInteraction, ModalSubmitInteraction, ActionRowBuilder, Message, ButtonBuilder, ButtonStyle, EmbedBuilder, TextChannel, StringSelectMenuInteraction } from "discord.js";
import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import type { Movie } from "../../models/Movie";
import { createMovieEmbed } from "./MovieEmbeds";
import { pickRandomMovie, buildMovieEmbedWithMeta } from "./MovieLocalSelector";
import type { MoviePoll } from "../../models/MoviePoll";
import type { PollSession } from "../../models/PollSession";
import { getManualPollSession, changeManualPollPage, clearManualPollSession, updateManualPollSelection, showMovieManualPollMenu } from "./MovieManualPoll";
import { pollMovieRandom, pollMovieWithList } from "./MoviePolls";

const movieFilePath = path.resolve(process.cwd(), 'src/data/movies.json');
const pollPath = path.resolve(process.cwd(), 'src/data/activeMoviePoll.json');

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

export async function handleMoviePickChooseModalSubmit(interaction: ModalSubmitInteraction) {
    const input = interaction.fields.getTextInputValue('movie_input').trim();

    if (!fs.existsSync(movieFilePath)) {
        await interaction.reply({ content: 'Movie list not found.', flags: 1 << 6 });
        return;
    }

    const rawData = fs.readFileSync(movieFilePath, 'utf-8');
    const movies: Movie[] = JSON.parse(rawData);

    if (!movies.length) {
        await interaction.reply({ content: 'Movie list is empty.', flags: 1 << 6 });
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
            keys: ['title'],
            threshold: 0.4,
            includeScore: true,
        });

        const results = fuse.search(input);
        if (results.length) {
            selectedMovie = results[0]?.item;
        }
    }

    if (!selectedMovie) {
        await interaction.reply({ content: 'No matching movie found.', flags: 1 << 6 });
        return;
    }

    const embed = createMovieEmbed(selectedMovie);
    const existingDescription = embed.data.description ?? '';
    const addedByLine = `\n\n_Added by <@${selectedMovie.addedBy}>_`;

    embed.setTitle(`🎯  ${selectedMovie.title} ${selectedMovie.releaseDate ? `(${selectedMovie.releaseDate})` : ''}`);
    embed.setDescription(`${existingDescription}${addedByLine}`);

    const channel = interaction.channel as TextChannel;
    await interaction.reply({
        content: `**${selectedMovie.title}** has been selected and posted!`,
        flags: 1 << 6
    });

    await channel.send({
        content: `The following movie has been selected for movie night:`,
        embeds: [embed],
    });
}

export async function handleRandomPollCountSelect(interaction: StringSelectMenuInteraction) {
    const selectedCount = parseInt(interaction.values[0]!, 10);
    await interaction.deferUpdate();
    await pollMovieRandom(interaction, selectedCount);
}

export async function handleConfirmRandomMovie(interaction: ButtonInteraction) {
    const message = interaction.message as Message;
    const embed = message.embeds[0];

    const channel = interaction.channel as TextChannel;

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
            content: 'Movie selected and posted!',
            embeds: [],
            components: []
        });
    } catch (error) {
        console.warn(`[MovieConfirm] Failed to clean up ephemeral message:`, error);
    }
}

export async function handleRerollRandomMovie(interaction: ButtonInteraction) {
    const newMovie = await pickRandomMovie();

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
            .setCustomId('confirm_random_movie')
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

export async function handleMoviePollVote(interaction: ButtonInteraction) {

    if (!fs.existsSync(pollPath)) {
        await interaction.reply({ content: 'Poll data not found.', flags: 1 << 6 });
        return;
    }

    const raw = fs.readFileSync(pollPath, 'utf-8');
    const poll: MoviePoll = JSON.parse(raw);

    if (!poll.isActive || interaction.message.id !== poll.messageId) {
        await interaction.reply({ content: 'This poll is no longer active.', flags: 1 << 6 });
        return;
    }

    const selectedIndex = parseInt(interaction.customId.replace('movie_vote_', ''), 10);
    const selectedMovie = poll.options[selectedIndex];
    if (!selectedMovie) {
        await interaction.reply({ content: 'Invalid vote option.', flags: 1 << 6 });
        return;
    }

    // Update vote map
    poll.votes[interaction.user.id] = selectedMovie.id;
    fs.writeFileSync(pollPath, JSON.stringify(poll, null, 2));

    // Calculate tallies
    const pollSession = getPollSession(poll);

    const updatedEmbeds: EmbedBuilder[] = interaction.message.embeds.map((embedData, i) => {
        const embed = EmbedBuilder.from(embedData);
        const movie = poll.options[i]!;
        const count = pollSession.optionVoteCounts.get(movie.id) ?? 0;
        const runtimeText = movie.runtime ? ` | ⏱️ ${movie.runtime} mins` : '';
        embed.setFooter({ text: `🗳️ ${count} vote${count !== 1 ? 's' : ''}${runtimeText} | Option ${i + 1}` });
        return embed;
    });

    const message = interaction.message as Message;
    await message.edit({ embeds: updatedEmbeds });

    await interaction.reply({
        content: `Thank you for your vote!`,
        flags: 1 << 6
    });
}

export async function handleManualPollInteraction(interaction: ButtonInteraction) {
    const uid = interaction.user.id;

    switch (interaction.customId) {
        case 'movie_poll_manual_prev':
            changeManualPollPage(uid, -1);
            return showMovieManualPollMenu(interaction);
        case 'movie_poll_manual_next':
            changeManualPollPage(uid, 1);
            return showMovieManualPollMenu(interaction);
        case 'movie_poll_manual_cancel':
            clearManualPollSession(uid);
            return interaction.update({ content: 'Poll creation cancelled.', embeds: [], components: [], flags: 1 << 6 });
        case 'movie_poll_manual_confirm': {
            const session = getManualPollSession(uid);
            if (!session || session.selected.size < 2 || session.selected.size > 5) {
                return interaction.reply({ content: `You must select between 2 and 5 movies.`, flags: 1 << 6 });
            }

            const allMovies: Movie[] = JSON.parse(fs.readFileSync(movieFilePath, 'utf-8'));
            const selectedMovieIds = Array.from(session.selected);
            const selectedMovies = allMovies.filter(m => selectedMovieIds.includes(m.id));

            clearManualPollSession(uid);

            return pollMovieWithList(interaction, selectedMovies);
        }
    }
}