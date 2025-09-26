export interface Poll<T> {
    // Unique identifier for the poll
    id: string;

    // The type of poll (for logging/analytics)
    type: "movie" | "task";

    // The options being voted on
    options: T[];

    // Discord message ID where the poll is taking place
    messageId: string;

    // When the poll was created
    createdAt: Date;

    // When the poll ends
    endsAt: Date;

    // Whether the poll is active or has ended
    isActive: boolean;

    // The ID of the winning option, if the poll has ended
    winningOptionId?: string;
}