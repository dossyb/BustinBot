import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { GuildScopedRepository } from "./CoreRepo.js";
import type { TaskLeaderboard, TaskLeaderboardId, TaskTierCounts } from "../../models/TaskLeaderboard.js";
import type { ITaskLeaderboardRepository } from "./interfaces/ITaskLeaderboardRepo.js";
import { taskLeaderboardConverter } from "./converters.js";

export class TaskLeaderboardRepository extends GuildScopedRepository<TaskLeaderboard> implements ITaskLeaderboardRepository {
    constructor(db: Firestore, guildId: string) {
        super(db, guildId, "taskLeaderboards", taskLeaderboardConverter);
    }

    async getLeaderboard(id: TaskLeaderboardId): Promise<TaskLeaderboard | null> {
        return await this.getById(id);
    }

    async createLeaderboard(data: TaskLeaderboard): Promise<void> {
        await this.createIfAbsent(data.id, data);
    }

    async updateLeaderboard(id: TaskLeaderboardId, data: Partial<TaskLeaderboard>): Promise<void> {
        await this.collection.doc(id).update(data);
    }

    async incrementPoints(
        id: TaskLeaderboardId,
        userId: string,
        amount: number,
        tierCounts: Partial<TaskTierCounts> = {}
    ): Promise<void> {
        await this.collection.doc(id).update({
            [`points.${userId}`]: FieldValue.increment(amount),
            ...Object.fromEntries(
                Object.entries(tierCounts).map(([tier, count]) => [`tierCounts.${userId}.${tier}`, FieldValue.increment(count)])
            ),
            updatedAt: new Date().toISOString(),
        });
    }
}
