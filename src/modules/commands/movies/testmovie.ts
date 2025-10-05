import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { fetchMovieDetails } from '../../movies/MovieService';
import { CommandRole, type Command } from '../../../models/Command';
import { createMovieEmbed } from '../../movies/MovieEmbeds';

const testmovie: Command = {
    name: 'testmovie',
    description: 'Search TMDb for a movie and preview its metadata.',
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('testmovie')
        .setDescription('Search TMDb for a movie and preview its metadata.')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('The title of the movie to search for.')
                .setRequired(true)
        ),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        const query = interaction.options.getString('title', true);
        await interaction.deferReply({ flags: 1 << 6 });

        try {
            const metadata = await fetchMovieDetails(query);

            if (!metadata) {
                await interaction.editReply(`No movie found for **${query}**.`);
                return;
            }

            const embed = createMovieEmbed(metadata);

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('[TestMovie Command Error]', error);
            await interaction.editReply('An error occurred while fetching movie data. Check console for details.');
        }
    }
};

export default testmovie;