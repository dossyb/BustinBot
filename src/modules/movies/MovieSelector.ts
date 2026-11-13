import { ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags } from "discord.js";
import { randomUUID } from "node:crypto";
import { createMovieEmbed, createMoviePreviewEmbeds } from "./MovieEmbeds.js";
import { addMovieWithStats, checkCanAddMovie, fetchMovieDetailsById, searchMovies } from "./MovieService.js";
import type { Movie } from "../../models/Movie.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";

export const ADD_MOVIE_BUTTON = "addmovie|";

export async function presentMovieSelection(
    interaction: ChatInputCommandInteraction,
    query: string,
    year?: number,
    maxResults = 3,
): Promise<void> {
    const results = await searchMovies(query, year);
    if (!results.length) {
        await interaction.editReply(`No results found for "${query}".`);
        return;
    }

    const topResults = results.slice(0, maxResults);
    const embeds = createMoviePreviewEmbeds(topResults);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...topResults.map((result, i) =>
            new ButtonBuilder()
                .setCustomId(`${ADD_MOVIE_BUTTON}select|${result.id}`)
                .setLabel(`${i + 1}`)
                .setStyle(ButtonStyle.Primary)
        ),
        new ButtonBuilder()
            .setCustomId(`${ADD_MOVIE_BUTTON}cancel`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Danger)
    );

    await interaction.editReply({ content: "Here are the **top 3** results for that movie; click the button that matches the movie you're looking for. If none of these match, click **Cancel** and try again with a different search term.", embeds, components: [buttons] });
}

export async function handleAddMovieButton(services: ServiceContainer, interaction: ButtonInteraction): Promise<void> {
    const [, action, id] = interaction.customId.split("|");
    if (action === "cancel") {
        await interaction.update({ content: "Cancelled movie selection.", components: [], embeds: [] });
        return;
    }

    await interaction.deferUpdate();
    const tmdbId = Number(id);
    const refusal = await checkCanAddMovie(services, interaction, tmdbId);
    if (refusal) {
        await interaction.followUp({ content: refusal, flags: MessageFlags.Ephemeral });
        return;
    }

    // Fetch full metadata from TMDb
    const metadata = await fetchMovieDetailsById(tmdbId);
    if (!metadata?.title) {
        await interaction.followUp({ content: `Could not fetch details for that movie.`, flags: MessageFlags.Ephemeral });
        return;
    }

    // Build movie object
    const movie: Movie = {
        ...metadata,
        id: randomUUID(),
        title: metadata.title,
        watched: false,
        addedBy: interaction.user.id,
        addedAt: new Date(),
    };
    // Save to Firestore
    await addMovieWithStats(movie, services);

    // Confirm addition
    const embed = createMovieEmbed(movie)
        .setTitle(`Added: ${movie.title}`)
        .setFooter({ text: `Added by ${interaction.user.username}` });
    await interaction.editReply({ content: "", embeds: [embed], components: [] });
    console.log(`[AddMovie] Added "${movie.title}" by ${interaction.user.username}`);
}