import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Message, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { pickRandomMovie, buildMovieEmbedWithMeta } from "../../movies/MovieLocalSelector.js";
import { showMovieManualPollMenu } from "../../movies/MovieManualPoll.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";

const pickmovie: Command = {
    name: 'pickmovie',
    description: 'Pick the movie for the next movie night (via poll, random roll, or specific movie).',
    module: CommandModule.Movie,
    allowedRoles: [CommandRole.MovieAdmin],

    slashData: new SlashCommandBuilder()
        .setName('pickmovie')
        .setDescription('Pick the movie for the next movie night (via poll, random roll, or specific movie).'),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('movie_pick_choose')
                .setLabel('🎯 Choose a movie')
                .setStyle(ButtonStyle.Primary),

            new ButtonBuilder()
                .setCustomId('movie_pick_random')
                .setLabel('🎲 Random movie')
                .setStyle(ButtonStyle.Danger),

            new ButtonBuilder()
                .setCustomId('movie_poll_random')
                .setLabel('📊 Poll random movies')
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId('movie_poll_manual')
                .setLabel('🗳️ Poll specific movies')
                .setStyle(ButtonStyle.Secondary)
        );

        const reply = await interaction.editReply({
            content: 'How would you like to pick the movie?',
            components: [row]
        }) as Message;

        const collector = reply.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 180000,
            filter: (btnInt) => btnInt.user.id === interaction.user.id,
        });

        collector.on('collect', async (btnInt) => {
            switch (btnInt.customId) {
                case 'movie_pick_choose':
                    const modal = new ModalBuilder()
                        .setCustomId('movie_pick_choose_modal')
                        .setTitle('Choose a movie')
                        .addComponents(
                            new ActionRowBuilder<TextInputBuilder>().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('movie_input')
                                    .setLabel('Enter movie title or list number')
                                    .setPlaceholder('e.g., 3 or The Matrix')
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(true)
                            )
                        );
                    await btnInt.showModal(modal);
                    break;
                case 'movie_pick_random':
                    await btnInt.deferUpdate();
                    const selectedMovie = await pickRandomMovie(services);

                    if (!selectedMovie) {
                        await interaction.followUp({ content: 'Movie list not found or is empty.', flags: 1 << 6 });
                        return;
                    }

                    const embed = await buildMovieEmbedWithMeta(selectedMovie, 'random');

                    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`confirm_random_movie_${selectedMovie.id}`)
                            .setLabel('🎥 Lock this in')
                            .setStyle(ButtonStyle.Success),

                        new ButtonBuilder()
                            .setCustomId('reroll_random_movie')
                            .setLabel('🔁 Reroll')
                            .setStyle(ButtonStyle.Danger)
                    );

                    await interaction.followUp({
                        content: 'A random movie has been selected:',
                        embeds: [embed],
                        components: [row],
                        flags: 1 << 6
                    });
                    break;
                case 'movie_poll_random':
                    await btnInt.deferUpdate();

                    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('movie_poll_random_count')
                            .setPlaceholder('Select how many movies to include')
                            .addOptions(
                                [2, 3, 4, 5].map(num => ({
                                    label: `${num} movies`,
                                    value: num.toString(),
                                }))
                            )
                    );

                    await interaction.followUp({
                        content: 'How many movies should be included in the poll?',
                        components: [selectRow],
                        flags: 1 << 6
                    });
                    break;
                case 'movie_poll_manual':
                    await btnInt.deferUpdate();
                    await showMovieManualPollMenu(services, interaction);
                    break;
            }
        });

        collector.on('end', async () => {
            await interaction.editReply({ components: [] });
        });
    },
};

export default pickmovie;