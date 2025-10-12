import { ButtonBuilder, ButtonStyle, ButtonInteraction, ActionRowBuilder, EmbedBuilder, Message, TextChannel, Client } from "discord.js";
import type { RepliableInteraction } from "discord.js";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { Movie } from "../../models/Movie";
import type { MoviePoll } from "../../models/MoviePoll";
import { injectMockUsers } from "./MovieMockUtils";
import { createLocalMoviePreviewEmbed } from "./MovieEmbeds";
import { saveCurrentMovie } from "./PickMovieInteractions";
import { DateTime } from "luxon";
import { scheduleActivePollClosure } from "./MoviePollScheduler";

const movieFilePath = path.resolve(process.cwd(), "src/data/movies.json");
const pollPath = path.resolve(process.cwd(), "src/data/activeMoviePoll.json");
const MAX_CHOICES = 5;
const emojiNumbers = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

async function createAndSendMoviePoll(
    interaction: RepliableInteraction,
    client: Client,
    movies: Movie[]
) {
    const pollId = uuidv4();
    const now = DateTime.utc();

    let endsAt = now.plus({ hours: 24 });

    // Check for scheduled movie night
    const movieNightPath = path.resolve(process.cwd(), 'src/data/movieNight.json');
    if (fs.existsSync(movieNightPath)) {
        try {
            const movieNightData = JSON.parse(fs.readFileSync(movieNightPath, 'utf-8'));
            if (movieNightData?.storedUTC) {
                const movieStart = DateTime.fromISO(movieNightData.storedUTC);
                if (movieStart.isValid) {
                    const oneHourBefore = movieStart.minus({ hours: 1 });

                    // Choose whichever comes first
                    if (oneHourBefore < endsAt) {
                        endsAt = oneHourBefore;
                        console.log(
                            `[MoviePoll] Adjusted poll close time to 1 hour before movie night (${oneHourBefore.toISO()})`
                        );
                    }
                }
            }
        } catch (error) {
            console.warn("[MoviePoll] Could not parse movieNight.json", error);
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
        const runtimeText = movie.runtime ? ` | ⏱️ ${movie.runtime} mins` : '';
        embed.setFooter({ text: `🗳️ 0 votes${runtimeText} | Option ${i + 1}` });
        return embed;
    });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        movies.map((movie, i) => {
            const truncatedTitle = movie.title.length > 20 ? movie.title.slice(0, 17) + '…' : movie.title;
            const label = `${emojiNumbers[i]} ${truncatedTitle}`;

            return new ButtonBuilder()
                .setCustomId(`movie_vote_${i}`)
                .setLabel(label)
                .setStyle(ButtonStyle.Secondary);
        })
    );

    const guildId = process.env.DISCORD_GUILD_ID;
    const roleName = process.env.MOVIE_USER_ROLE_NAME;

    let mention = '';
    if (guildId && roleName) {
        const guild = await client.guilds.fetch(guildId);
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (role) {
            mention = `<@&${role.id}>`;
        } else {
            console.warn(`[MoviePoll] Could not find role named "${roleName}". Proceeding without mention.`);
        }
    }

    const channel = interaction.channel as TextChannel;
    await channel.send(`${mention}`);

    const pollCloseUnix = Math.floor(endsAt.toSeconds());

    const message = await channel.send({
        content: `📊 **Vote for the next movie night pick!**\n Poll ends <t:${pollCloseUnix}:R> (<t:${pollCloseUnix}:F>).`,
        embeds,
        components: [row],
    }) as Message;

    poll.messageId = message.id;
    fs.writeFileSync(pollPath, JSON.stringify(poll, null, 2));

    await scheduleActivePollClosure();
}

export async function pollMovieRandom(interaction: RepliableInteraction, count: number | null) {
    const client = interaction.client;

    if (!fs.existsSync(movieFilePath)) {
        await interaction.editReply("No movies found.");
        return;
    }

    let movies: Movie[] = JSON.parse(fs.readFileSync(movieFilePath, "utf-8"));
    movies = injectMockUsers(movies);

    if (!movies.length) {
        await interaction.editReply("The movie list is empty.");
        return;
    }

    const userMovieMap = new Map<string, Movie[]>();
    for (const movie of movies) {
        if (!userMovieMap.has(movie.addedBy)) {
            userMovieMap.set(movie.addedBy, []);
        }
        userMovieMap.get(movie.addedBy)!.push(movie);
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

    const shuffled = uniqueMovies.sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, maxChoices);

    await createAndSendMoviePoll(interaction, client, selected);
}

export async function pollMovieWithList(interaction: RepliableInteraction, selected: Movie[]) {
    const client = interaction.client;

    if (selected.length < 2 || selected.length > MAX_CHOICES) {
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply("You must select between 2 and 5 movies.");
        } else {
            await interaction.reply({ content: "You must select between 2 and 5 movies.", flags: 1 << 6 });
        }
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

    await createAndSendMoviePoll(interaction, client, moviesWithUsers);
}

export async function closeActiveMoviePoll(closedBy: string): Promise<{ success: boolean; message: string; winner?: Movie, winningVotes?: number, tieBreak?: boolean }> {
    const pollPath = path.resolve(process.cwd(), 'src/data/activeMoviePoll.json');
    const currentMoviePath = path.resolve(process.cwd(), 'src/data/currentMovie.json');

    if (!fs.existsSync(pollPath)) {
        return { success: false, message: "No active poll found." };
    }

    const pollData: MoviePoll = JSON.parse(fs.readFileSync(pollPath, 'utf-8'));

    if (!pollData.isActive) {
        return { success: false, message: "The poll is already closed." };
    }

    if (!pollData.votes || Object.keys(pollData.votes).length === 0) {
        return { success: false, message: "No votes were cast in this poll. Cannot determine a winner." };
    }

    // Tally votes
    const voteCounts = new Map<string, number>();
    for (const option of pollData.options) {
        voteCounts.set(option.id, 0);
    }

    Object.values(pollData.votes).forEach((movieId) => {
        if (voteCounts.has(movieId)) {
            voteCounts.set(movieId, (voteCounts.get(movieId) ?? 0) + 1);
        }
    });

    // Sort by vote count descending
    const sorted = [...voteCounts.entries()].sort((a, b) => b[1] - a[1]);
    const topEntry = sorted[0];

    if (!topEntry) {
        return { success: false, message: "Could not determine a winning movie (no votes counted)." };
    }

    const [topMovieId, topVotes] = topEntry;

    // Handle tiebreaks
    const tiedEntries = sorted.filter(([_, votes]) => votes === topVotes);
    let winningId = topMovieId;
    let tieBreak = false;

    if (tiedEntries.length > 1) {
        tieBreak = true;
        const randomIndex = Math.floor(Math.random() * tiedEntries.length);
        const chosen = tiedEntries[randomIndex];
        if (chosen) {
            winningId = chosen[0];
        }
        console.log(`[MoviePoll] Tie detected! ${tiedEntries.length} movies had ${topVotes} votes. Randomly selected one.`);
    }

    const winningMovie = pollData.options.find((m) => m.id === winningId);
    if (!winningMovie) {
        return { success: false, message: "Could not find the winning movie in poll options." };
    }

    // Mark poll inactive
    pollData.isActive = false;
    fs.writeFileSync(pollPath, JSON.stringify(pollData, null, 2));

    saveCurrentMovie(winningMovie);

    const baseMessage = tieBreak
        ? `Poll closed successfully. After a tie with ${topVotes} votes, BustinBot chose ${winningMovie.title}`
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