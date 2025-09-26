export interface Movie {
    // Unique identifier for the movie
    id: string;

    // Title of the movie as entered or pulled from API
    title: string;

    // Year of release, if known
    year?: number;

    // Optional URL to a poster image
    posterUrl?: string;

    // Optional URL to more information (e.g. IMDb page)
    infoUrl?: string;

    // Optional description or plot summary
    description?: string;

    // Whether the movie has been watched
    watched: boolean;

    // Discord user ID of the person who added the movie
    addedBy: string;
    
    // Timestamp when the movie was added
    addedAt: Date;

    // Optional timestamp when the movie was watched
    watchedAt?: Date;
}