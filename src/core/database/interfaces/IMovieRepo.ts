import type { Movie } from "../../../models/Movie";
import type { MovieEvent } from "../../../models/MovieEvent";
import type { MoviePoll } from "../../../models/MoviePoll";

export interface IMovieRepository {
    getAllMovies(): Promise<Movie[]>;
    getMovieById(id: string): Promise<Movie | null>;
    upsertMovie(movie: Movie): Promise<void>;
    deleteMovie(id: string): Promise<void>;

    createPoll(poll: MoviePoll): Promise<void>;
    getActivePoll(): Promise<MoviePoll | null>;
    closePoll(pollId: string): Promise<void>;
    clearPolls(): Promise<void>;

    createMovieEvent(event: MovieEvent): Promise<void>;
    getLatestEvent(): Promise<MovieEvent | null>;
    getAllEvents(): Promise<MovieEvent[]>;
    clearEvents(): Promise<void>;
}