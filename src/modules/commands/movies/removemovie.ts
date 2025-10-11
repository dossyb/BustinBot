import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import type { Command } from "../../../models/Command";
import { CommandRole } from "../../../models/Command";
import { createMovieEmbed } from "../../movies/MovieEmbeds";
import type { Movie } from "../../../models/Movie";

const movieFilePath = path.resolve(process.cwd(), 'src/data/movies.json');

const removemovie: Command = {
    name: 'removemovie',
    description: 'Remove a movie you have added from the list (removie).',
    allowedRoles: [CommandRole.Everyone, CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName('removemovie')
        .setDescription('Remove a movie you have added from the list (removie).')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('The movie title to remove.')
                .setRequired(true)
        ),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const query = interaction.options.getString('title', true);
        const userId = interaction.user.id;
        const isAdmin = interaction.memberPermissions?.has('Administrator') || false;

        let movies: Movie[] = [];
        if (fs.existsSync(movieFilePath)) {
            const data = fs.readFileSync(movieFilePath, 'utf-8');
            movies = data ? JSON.parse(data) : [];
        }

        const fuse = new Fuse(movies, {
            keys: ['title'],
            threshold: 0.4,
        });

        const results = fuse.search(query);

        if (results.length === 0) {
            await interaction.editReply(`No matching movie found for \`${query}\`.`);
            return;
        }

        const matched = results[0]!.item;

        // Permission check
        if (matched.addedBy !== userId && !isAdmin) {
            await interaction.editReply(`You can only remove movies you have added.`);
            return;
        }

        const updatedMovies = movies.filter(m => m.id !== matched.id);
        fs.writeFileSync(movieFilePath, JSON.stringify(updatedMovies, null, 2));

        const embed = createMovieEmbed(matched)
            .setTitle(`🗑️ Removed: ${matched.title}`)
            .setFooter({ text: `Removed by ${interaction.user.username}` });

        await interaction.editReply({
            content: `Movie **${matched.title}** has been removed.`,
            embeds: [embed],
        });
    }
};

export default removemovie;