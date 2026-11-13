import type { MockAgent } from "undici";
import { JSON_REPLY } from "./firestoreEmulator.js";

const TMDB = "https://api.themoviedb.org";

export type TMDbMovie = { id: number; title: string; release_date: string; overview: string };

export function tmdbSearch(http: MockAgent, query: string, results: TMDbMovie[]): void {
    http.get(TMDB)
        .intercept({ path: "/3/search/movie", query: { api_key: process.env.TMDB_API_KEY, query }, method: "GET" })
        .reply(200, { results }, JSON_REPLY);
}

export function tmdbMovie(http: MockAgent, movie: TMDbMovie, runtime: number, director: string): void {
    const tmdb = http.get(TMDB);
    const query = { api_key: process.env.TMDB_API_KEY, language: "en-US" };
    tmdb.intercept({ path: `/3/movie/${movie.id}`, query, method: "GET" }).reply(
        200,
        { ...movie, runtime, vote_average: 8.2, genres: [{ id: 1, name: "Action" }] },
        JSON_REPLY,
    );
    tmdb.intercept({ path: `/3/movie/${movie.id}/credits`, query, method: "GET" }).reply(
        200,
        { cast: [{ name: "Keanu Reeves", order: 0 }], crew: [{ job: "Director", name: director }] },
        JSON_REPLY,
    );
}
