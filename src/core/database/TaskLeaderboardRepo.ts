import { FieldValue } from "firebase-admin/firestore";
import { GuildScopedRepository } from "./CoreRepo.js";
import type { TaskLeaderboard, TaskLeaderboardId } from "../../models/TaskLeaderboard.js";
import type { ITaskLeaderboardRepository } from "./interfaces/ITaskLeaderboardRepo.js";

export class TaskLeaderboardRepository extends GuildScopedRepository<TaskLeaderboard> implements ITaskLeaderboardRepository {
    constructor(guildId: string) {
        super(guildId, "taskLeaderboards");
    }

    async getLeaderboard(id: TaskLeaderboardId): Promise<TaskLeaderboard | null> {
        return await this.getById(id);
    }

    async createLeaderboard(data: TaskLeaderboard): Promise<void> {
        await this.collection.doc(data.id).set(data);
    }

    async updateLeaderboard(id: TaskLeaderboardId, data: Partial<TaskLeaderboard>): Promise<void> {
        await this.collection.doc(id).update(data);
    }

    async incrementPoints(id: TaskLeaderboardId, userId: string, amount: number): Promise<void> {
        await this.collection.doc(id).update({
            [`points.${userId}`]: FieldValue.increment(amount),
            updatedAt: new Date().toISOString(),
        });
    }

    async incrementTierCount(
        id: TaskLeaderboardId,
        userId: string,
        tier: "bronze" | "silver" | "gold",
        amount: number
    ): Promise<void> {
        await this.collection.doc(id).update({
            [`tierCounts.${userId}.${tier}`]: FieldValue.increment(amount),
            updatedAt: new Date().toISOString(),
        });
    }
}
