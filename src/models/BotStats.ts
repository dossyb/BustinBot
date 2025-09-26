export interface BotStats {
    // When the bot was first started (uptime reference)
    startedAt: Date;

    // Total number of commands executed since startup
    commandsRun: number;

    // Breakdown of commands run by name
    commandsByName: Record<string, number>;

    // Total number of messages processed (not just commands)
    messagesSeen: number;

    // Guild statistics
    guildCount: number;
    channelCount: number;
    userCount: number;

    // Movie module statistics
    moviesAdded: number;
    moviesWatched: number;
    moviePollsRun: number;
    movieEventsHosted: number;

    // Task module statistics
    tasksAdded: number;
    taskPollsRun: number;
    tasksCompleted: number;

    // Fun stats
    funStats: {
        bustinCount: number;
        goodbotCount: number;
        badbotCount: number;

        [key: string]: number;
    }

    // Errors tracked (for debugging / health monitoring)
    errorCount: number;

    // Last time stats were updated
    lastUpdatedAt: Date;
}