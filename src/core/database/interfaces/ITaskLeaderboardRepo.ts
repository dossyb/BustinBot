import type { TaskLeaderboard, TaskLeaderboardId, TaskTierCounts } from "../../../models/TaskLeaderboard.js";

export interface ITaskLeaderboardRepository {
    getLeaderboard(id: TaskLeaderboardId): Promise<TaskLeaderboard | null>;
    createLeaderboard(data: TaskLeaderboard): Promise<void>;
    updateLeaderboard(id: TaskLeaderboardId, data: Partial<TaskLeaderboard>): Promise<void>;
    incrementPoints(
        id: TaskLeaderboardId,
        userId: string,
        amount: number,
        tierCounts?: Partial<TaskTierCounts>
    ): Promise<void>;
}
