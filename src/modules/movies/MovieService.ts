import fetch from 'node-fetch';
import dotenv from 'dotenv';
import type { Movie } from '../../models/Movie';
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
