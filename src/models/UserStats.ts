export interface UserStats {
    // Discord user ID
    userId: string;

    // General participation
    // First bot interaction
    joinedAt: Date;

    // Last time they used a command or feature
    lastActiveAt: Date;

    // Total commands run
    commandsRun: number;

    // Movie module stats
    // How many movies they've added to the pool
    moviesAdded: number;

    // How many movies they've added that have been watched
    moviesWatched: number;

    // How many movie nights they've attended
    moviesAttended: number;

    // How many movie polls they've voted in
    moviePollsVoted: number;

    // Task module stats
    // Total number of tasks they've completed for each tier
    tasksCompletedBronze: 0,
    tasksCompletedSilver: 0,
    tasksCompletedGold: 0,

    // Current completion streak
    taskStreak: number;

    // Longest completion streak
    longestTaskStreak: number;

    // How many task polls they've voted in
    taskPollsVoted: number;

    // How many prizes they've won
    taskPrizesWon: number;

    // Completed task count from v1 task system
    legacyTasksCompleted: number;

    // Total XP for leaderboards
    totalXP?: number;

    // Cached leaderboard rank
    leaderboardRank?: number;
}