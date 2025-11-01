import type { Movie } from "./Movie.js";

export interface MovieEvent {
    // Unique identifier for the event
    id: string;

    // Timestamp when the event record was created
    createdAt: Date;

    // The scheduled start time for the movie event (UTC)
    startTime: Date;

    // The movie being watched
    movie: Movie;

    // Discord channel ID where the event is taking place
    channelId: string;

    // Role ID to ping when announcing
    roleId?: string;

    // Whether the event has concluded
    completed: boolean;

    // Timestamp when the event was actually completed
    completedAt?: Date;

    // Discord message ID of the announcement
    announcementMessageId?: string;

    // Votes or poll results that led to this movie being chosen
    pollResults?: {
        movieId: string;
        votes: number;
    }

    // Discord user ID of the host or organiser
    hostedBy: string;
}