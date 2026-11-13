import { GuildScopedRepository } from "./CoreRepo.js";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { IUserRepository } from "./interfaces/IUserRepo.js";
import type { UserStats } from "../../models/UserStats.js";
import { userStatsConverter } from "./converters.js";

export class UserRepository extends GuildScopedRepository<UserStats> implements IUserRepository {
    constructor(db: Firestore, guildId: string) {
        super(db, guildId, "userStats", userStatsConverter);
    }

    private createDefaultUserStats(userId: string): UserStats {
        return {
            userId,
            joinedAt: new Date(),
            lastActiveAt: new Date(),
            commandsRun: 0,
            moviesAdded: 0,
            moviesWatched: 0,
            moviesAttended: 0,
            moviePollsVoted: 0,
            tasksCompletedBronze: 0,
            tasksCompletedSilver: 0,
            tasksCompletedGold: 0,
            taskStreak: 0,
            longestTaskStreak: 0,
            taskPollsVoted: 0,
            taskPrizesWon: 0,
            taskChampionFirsts: 0,
            taskChampionSeconds: 0,
            taskChampionThirds: 0,
            legacyTasksCompleted: 0,
            totalXP: 0,
            leaderboardRank: 0,
        };
    }

    async getAllUsers(): Promise<UserStats[]> {
        const snapshot = await this.collection.get();
        return snapshot.docs.map((doc) => doc.data());
    }

    async getUserById(userId: string): Promise<UserStats | null> {
        const doc = await this.collection.doc(userId).get();
        return doc.data() ?? null;
    }

    async createUser(user: UserStats): Promise<void> {
        await this.collection.doc(user.userId).set(user);
    }

    async updateUser(userId: string, data: Partial<UserStats>): Promise<void> {
        await this.collection.doc(userId).update(data);
    }

    async deleteUser(userId: string): Promise<void> {
        await this.collection.doc(userId).delete();
    }

    async clearAllUsers(): Promise<void> {
        const snapshot = await this.collection.get();
        const batch = this.db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    async incrementStat(
        userId: string,
        field: keyof UserStats,
        amount = 1
    ): Promise<void> {
        const docRef = this.collection.doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
            const newStats = this.createDefaultUserStats(userId);
            (newStats as any)[field] = amount;
            await docRef.set(newStats);
            return;
        }

        // If exists, increment the field
        await docRef.update({
            [field]: FieldValue.increment(amount),
            lastActiveAt: new Date(),
        });
    }

    async updateTierStat(
        userId: string,
        fromField: keyof UserStats,
        toField: keyof UserStats
    ): Promise<void> {
        const docRef = this.collection.doc(userId);
        const doc = await docRef.get();

        if (!doc.exists) {
            const newStats = this.createDefaultUserStats(userId);
            (newStats as any)[toField] = 1;
            await docRef.set(newStats);
            return;
        }

        await docRef.update({
            [fromField]: FieldValue.increment(-1),
            [toField]: FieldValue.increment(1),
            lastActiveAt: new Date(),
        });
    }

    async updateLastActive(userId: string): Promise<void> {
        await this.collection.doc(userId).update({
            lastActiveAt: new Date(),
        });
    }
}
