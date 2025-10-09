import { ButtonBuilder, ButtonStyle, ButtonInteraction, ActionRowBuilder, EmbedBuilder, Message, TextChannel, Client } from "discord.js";
import type { RepliableInteraction } from "discord.js";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { Movie } from "../../models/Movie";
import type { MoviePoll } from "../../models/MoviePoll";
import { injectMockUsers } from "./MovieMockUtils";
import { createLocalMoviePreviewEmbed } from "./MovieEmbeds";

const movieFilePath = path.resolve(process.cwd(), "src/data/movies.json");
const pollPath = path.resolve(process.cwd(), "src/data/activeMoviePoll.json");
const POLL_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_CHOICES = 5;
const emojiNumbers = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

async function createAndSendMoviePoll(
    interaction: RepliableInteraction,
    client: Client,
    movies: Movie[]
) {
    const pollId = uuidv4();
    const now = new Date();
    const ends = new Date(now.getTime() + POLL_DURATION_MS);

    const poll: MoviePoll = {
        id: pollId,
        type: "movie",
        options: movies,
        messageId: "",
        createdAt: now,
        endsAt: ends,
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
    const message = await channel.send({
        content: `📊 **Vote for the next movie night pick!**\n Poll ends in 24 hours.`,
        embeds,
        components: [row],
    }) as Message;

    poll.messageId = message.id;
    fs.writeFileSync(pollPath, JSON.stringify(poll, null, 2));
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
