import type { Movie } from "../../../models/Movie.js";
import type { MovieEvent } from "../../../models/MovieEvent.js";
import type { MoviePoll } from "../../../models/MoviePoll.js";

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
    getActiveEvent(): Promise<MovieEvent | null>;
    getLatestEvent(): Promise<MovieEvent | null>;
    getAllEvents(): Promise<MovieEvent[]>;
    clearEvents(): Promise<void>;
    voteInPollOnce(pollId: string, userId: string, optionId: string): Promise<{ firstTime: boolean, updatedPoll: MoviePoll; }>;
}
