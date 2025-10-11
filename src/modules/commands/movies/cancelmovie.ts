import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from "discord.js";
import fs from 'fs';
import path from 'path';
import type { Command } from "../../../models/Command";
import { CommandRole } from "../../../models/Command";

const currentMoviePath = path.resolve(process.cwd(), 'src/data/currentMovie.json');
const movieNightPath = path.resolve(process.cwd(), 'src/data/movieNight.json');
const activeMoviePollPath = path.resolve(process.cwd(), 'src/data/activeMoviePoll.json');

const cancelmovie: Command = {
    name: 'cancelmovie',
    description: 'Cancel the currently scheduled movie night and selected movie.',
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName('cancelmovie')
        .setDescription('Cancel the currently scheduled movie night and selected movie.'),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply("Could not identify the guild. Please try again in a server channel.");
            return;
        }

        // Delete stored files if they exist
        const deletedFiles: string[] = [];

        for (const file of [currentMoviePath, movieNightPath]) {
            if (fs.existsSync(file)) {
                try {
                    fs.unlinkSync(file);
                    deletedFiles.push(path.basename(file));
                } catch (err) {
                    console.warn(`[CancelMovie] Failed to delete ${file}:`, err);
                }
            }
        }

        // Deactivate active poll if any
        if (fs.existsSync(activeMoviePollPath)) {
            try {
                const poll = JSON.parse(fs.readFileSync(activeMoviePollPath, 'utf-8'));
                if (poll.isActive) {
                    poll.isActive = false;
                    fs.writeFileSync(activeMoviePollPath, JSON.stringify(poll, null, 2));
                    deletedFiles.push("activeMoviePoll.json (set inactive)");
                }
            } catch (err) {
                console.warn("[CancelMovie] Failed to update activeMoviePoll.json:", err);
            }
        }

        // Post public message to movie night channel
        const movieChannel = guild.channels.cache.find(
            (ch) => ch.name === 'movie-night' && ch.isTextBased()
        ) as TextChannel | undefined;

        if (movieChannel) {
            await movieChannel.send({ content: 'Movie night has been cancelled.'});
        } else {
            console.warn("[CancelMovie] Could not find movie night channel.");
        }

        // Reply privately to admin confirming
        const summary =
            deletedFiles.length > 0
                ? ` Cleared: ${deletedFiles.join(", ")}`
                : 'No movie data was found to clear.';

        await interaction.editReply({
            content: `Movie night cancelled successfully. \n${summary}`,
        });
    },
};

export default cancelmovie;