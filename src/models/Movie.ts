export interface Movie {
    // Unique identifier for the movie
    id: string;

    // ID of the movie on TMDb
    tmdbId?: number | undefined;

    // Title of the movie as entered or pulled from API
    title: string;

    // Year of release, if known
    releaseDate?: number | undefined;

    // Optional URL to a poster image
    posterUrl?: string | undefined;

    // Optional link to TMDb page
    infoUrl?: string | undefined;

    // Optional description or plot summary
    overview?: string | undefined;

    // Whether the movie has been watched
    watched: boolean;

    // Discord user ID of the person who added the movie
    addedBy: string;

    // Optional display override for the contributor (used in dev mode to mask IDs)
    addedByDisplay?: string | undefined;

    // Optional mock contributor id used in dev mode
    addedByDevId?: string | undefined;
    
    // Timestamp when the movie was added
    addedAt: Date;

    // Optional timestamp when the movie was watched
    watchedAt?: Date | undefined;

    // The movie's runtime in minutes
    runtime?: number | undefined;

    genres?: string[] | undefined;

    rating?: number | undefined;

    director?: string | undefined;
    cast?: string[] | undefined;

    // Timestamp indicating when the movie was selected for movie night
    selectedAt?: Date | undefined;

    // Discord user ID of the person who selected the movie
    selectedBy?: string | undefined;
}
