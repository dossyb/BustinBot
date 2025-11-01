import fetch from 'node-fetch';
import dotenv from 'dotenv';
import type { Movie } from '../../models/Movie';
import type { ServiceContainer } from 'core/services/ServiceContainer';
dotenv.config();

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

if (!TMDB_API_KEY) {
    throw new Error('TMDB_API_KEY is not set in your environment variables.');
}

// TMDb Response Types
interface TMDbSearchResult {
    id: number;
    title: string;
    release_date?: string;
    overview?: string;
    poster_path?: string;
}

interface TMDbSearchResponse {
    results: TMDbSearchResult[];
}

interface TMDbDetailsResponse extends TMDbSearchResult {
    runtime?: number;
    vote_average?: number;
    genres?: { id: number; name: string }[];
    backdrop_path?: string;
}

interface TMDbCreditsResponse {
    cast: { name: string; order: number }[];
    crew: { job: string; name: string }[];
}

export async function fetchMovieDetails(movieName: string): Promise<Partial<Movie> | null> {
    const searchUrl = `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(movieName)}`;

    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json() as TMDbSearchResponse;

    if (!searchData?.results?.length) return null;

    const topResult = searchData.results[0]!;

    const detailsUrl = `${TMDB_BASE_URL}/movie/${topResult.id}?api_key=${TMDB_API_KEY}`;
    const detailsResponse = await fetch(detailsUrl);
    const detailsData = (await detailsResponse.json()) as TMDbDetailsResponse;

    return {
        tmdbId: detailsData.id,
        title: detailsData.title,
        overview: detailsData.overview,
        releaseDate: detailsData.release_date
            ? Number(detailsData.release_date.slice(0, 4))
            : undefined,
        posterUrl: detailsData.poster_path
            ? `${TMDB_IMAGE_BASE}${detailsData.poster_path}`
            : undefined,
        infoUrl: `https://www.themoviedb.org/movie/${detailsData.id}`,
        runtime: detailsData.runtime ?? undefined,
        rating: detailsData.vote_average ?? undefined,
        genres: detailsData.genres?.map((g) => g.name) ?? undefined,
    } satisfies Partial<Movie>;
}

export async function fetchMovieDetailsById(id: number): Promise<Partial<Movie> | null> {
    const detailsUrl = `${TMDB_BASE_URL}/movie/${id}?api_key=${TMDB_API_KEY}&language=en-US`;
    const creditsUrl = `${TMDB_BASE_URL}/movie/${id}/credits?api_key=${TMDB_API_KEY}&language=en-US`;

    const [detailsRes, creditsRes] = await Promise.all([
        fetch(detailsUrl),
        fetch(creditsUrl),
    ]);

    if (!detailsRes.ok) throw new Error("Failed to fetch TMDb details");
    if (!creditsRes.ok) throw new Error("Failed to fetch TMDb credits");

    const details = (await detailsRes.json()) as TMDbDetailsResponse;
    const credits = (await creditsRes.json()) as TMDbCreditsResponse;

    if (!details?.id) return null;

    // Extract director and top 3 billed cast
    const director =
        credits.crew?.find((member) => member.job === "Director")?.name ?? undefined;
    const cast =
        credits.cast?.slice(0, 3).map((actor) => actor.name).filter(Boolean) ?? [];

    return {
        tmdbId: details.id,
        title: details.title,
        overview: details.overview,
        releaseDate: details.release_date
            ? Number(details.release_date.slice(0, 4))
            : undefined,
        posterUrl: details.poster_path
            ? `${TMDB_IMAGE_BASE}${details.poster_path}`
            : undefined,
        infoUrl: `https://www.themoviedb.org/movie/${details.id}`,
        runtime: details.runtime ?? undefined,
        rating: details.vote_average ?? undefined,
        genres: details.genres?.map((g) => g.name) ?? undefined,
        director,
        cast,
    };
}

export async function addMovieWithStats(movie: Movie, services: ServiceContainer) {
    const movieRepo = services.repos.movieRepo;
    const userRepo = services.repos.userRepo;

    if (!movieRepo || !userRepo) {
        throw new Error("[MovieService] Missing repositories.");
    }

    await movieRepo.upsertMovie(movie);
    await userRepo.incrementStat(movie.addedBy, "moviesAdded", 1);
}

export async function removeMovieWithStats(movie: Movie, services: ServiceContainer) {
    const movieRepo = services.repos.movieRepo;
    const userRepo = services.repos.userRepo;

    if (!movieRepo) {
        throw new Error("[MovieService] Missing movie repository.");
    }

    await movieRepo.deleteMovie(movie.id);

    if (!movie.watched && userRepo) {
        await userRepo.incrementStat(movie.addedBy, "moviesAdded", -1);
    } else if (!userRepo) {
        console.warn("[MovieService] User repository unavailable; skipping moviesAdded decrement.");
    }
}
