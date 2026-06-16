export type TaskLeaderboardId = "lifetime" | "periodic";

export interface TaskLeaderboardEntry {
    userId: string;
    points: number;
}

export interface TaskTierCounts {
    bronze: number;
    silver: number;
    gold: number;
}

export interface TaskLeaderboardPeriod {
    length: number;
    eventIds: string[];
    startedAt: string;
    index: number;
}

export interface TaskLeaderboardCompletedPeriod {
    index: number;
    eventIds: string[];
    endedAt: string;
    topThree: TaskLeaderboardEntry[];
    topTen?: TaskLeaderboardEntry[];
    tierCounts?: Record<string, TaskTierCounts>;
}

export interface TaskLeaderboardPendingPeriod {
    period: TaskLeaderboardPeriod;
    points: Record<string, number>;
    tierCounts?: Record<string, TaskTierCounts>;
}

export interface TaskLeaderboardChampions {
    first?: string[];
    second?: string[];
    third?: string[];
    awardedAt?: string;
    periodIndex?: number;
}

export interface TaskLeaderboard {
    id: TaskLeaderboardId;
    points: Record<string, number>;
    tierCounts?: Record<string, TaskTierCounts>;
    createdAt: string;
    updatedAt: string;
    period?: TaskLeaderboardPeriod;
    completedPeriod?: TaskLeaderboardCompletedPeriod;
    pendingPeriod?: TaskLeaderboardPendingPeriod | null;
    champions?: TaskLeaderboardChampions;
}
