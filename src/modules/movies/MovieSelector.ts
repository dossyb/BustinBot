import { ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ComponentType, Message } from "discord.js";
import { createMoviePreviewEmbeds } from "./MovieEmbeds";


export async function presentMovieSelection(
    interaction: ChatInputCommandInteraction,
    query: string,
    year?: number,
    maxResults = 3
): Promise<any | null> {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}${year ? `&year=${year}` : ''}`;
    const response = await fetch(searchUrl);
    const data = await response.json();

    if (!data?.results?.length) {
        await interaction.editReply(`No results found for "${query}".`);
        return null;
    }

    const topResults = data.results.slice(0, maxResults);
    const embeds = createMoviePreviewEmbeds(topResults);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...topResults.map((_: any, i: number) =>
            new ButtonBuilder()
                .setCustomId(`movie_select_${i}`)
                .setLabel(`${i + 1}`)
                .setStyle(ButtonStyle.Primary)
        ),
        new ButtonBuilder()
            .setCustomId(`movie_cancel`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    const reply = await interaction.editReply({ embeds, components: [buttons] }) as Message;

    const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 180000,
        filter: (btnInt) => btnInt.user.id === interaction.user.id,
    });

    return new Promise((resolve) => {
        collector.on('collect', async (btnInt) => {
            if (btnInt.customId === 'movie_cancel') {
                await btnInt.update({ content: 'Cancelled movie selection.', components: [], embeds: [] });
                collector.stop();
                resolve(null);
                return;
            }

            const index = parseInt(btnInt.customId.replace('movie_select_', ''), 10);
            const selected = topResults[index];
            await btnInt.deferUpdate();

            // await interaction.editReply({ content: `Selected **${selected.title}** **${selected.year}**`, embeds: [], components: [] });
            collector.stop();
            resolve(selected);
        });

        collector.on('end', async (_, reason) => {
            if (reason === 'time') {
                await interaction.editReply({ content: 'Movie selection timed out.', embeds: [], components: [] });
                resolve(null);
            }
        })
    });
}