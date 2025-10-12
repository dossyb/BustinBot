import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import fs from 'fs';
import path from 'path';
import type { Command } from '../../../models/Command';
import { CommandRole } from '../../../models/Command';
import { createMovieNightEmbed } from '../../movies/MovieEmbeds';
import type { Movie } from '../../../models/Movie';

const currentMoviePath = path.resolve(process.cwd(), 'src/data/currentMovie.json');
const movieNightPath = path.resolve(process.cwd(), 'src/data/movieNight.json');

const currentmovie: Command = {
    name: 'currentmovie',
    description: 'View the currently scheduled movie night details.',
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName('currentmovie')
        .setDescription('View the currently scheduled movie night details.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        // Load current movie data
        if (!fs.existsSync(movieNightPath)) {
            await interaction.editReply("No movie night is currently scheduled.");
            return;
        }

        const movieNightData = JSON.parse(fs.readFileSync(movieNightPath, 'utf-8'));
        const currentMovie: Movie | null = fs.existsSync(currentMoviePath)
            ? JSON.parse(fs.readFileSync(currentMoviePath, 'utf-8'))
            : null;


        const readableDate = new Date(movieNightData.storedUTC).toLocaleDateString("en-AU", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
        });

        const unixTimestamp = Math.floor(new Date(movieNightData.storedUTC).getTime() / 1000);

        // Determine current state message
        let stateMessage = "";
        if (currentMovie) {
            stateMessage = `🎬 We will be watching **${currentMovie.title}**!`;
        } else {
            stateMessage = "📭 No movie has been selected yet.";
        }

        const embed = createMovieNightEmbed(
            currentMovie,
            unixTimestamp,
            stateMessage,
            interaction.user.username
        );

        await interaction.editReply({
            embeds: [embed],
        });
    },
};

export default currentmovie;