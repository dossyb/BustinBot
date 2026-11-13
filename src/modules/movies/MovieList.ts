import type { InteractionEditReplyOptions } from "discord.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { listPage, pageButtons } from "../../utils/Pagination.js";
import { createMovieListEmbeds } from "./MovieEmbeds.js";

const MOVIES_PER_PAGE = 3;

export const MOVIE_LIST_BUTTON = "listmovies|";

export async function buildMovieListPage(
    services: ServiceContainer,
    requestedPage: number,
): Promise<InteractionEditReplyOptions> {
    // Load movies from Firestore
    const movies = (await services.repos.movieRepo.getAllMovies())
        .filter((movie) => !movie.watched)
        .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());

    if (!movies.length) {
        return {
            content: "No unwatched movies are currently queued. Add a new one with `/addmovie`!",
            embeds: [],
            components: [],
        };
    }

    const { page, lastPage, items } = listPage(movies, MOVIES_PER_PAGE, requestedPage);
    const embeds = createMovieListEmbeds(items, page, MOVIES_PER_PAGE);
    return { content: "", embeds, components: [pageButtons(MOVIE_LIST_BUTTON, page, lastPage)] };
}
