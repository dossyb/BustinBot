import { db } from "./firestore";
import { FieldValue } from "firebase-admin/firestore";
import type { IBotRepository } from "./interfaces/IBotRepo";
import type { BotStats } from "../../models/BotStats";

export class BotRepository implements IBotRepository {
    private readonly docRef = db.collection('bot').doc('stats');

    async getBotStats(): Promise<BotStats | null> {
        const doc = await this.docRef.get();
        return doc.exists ? (doc.data() as BotStats) : null;
    }

    async initBotStats(defaults: BotStats): Promise<void> {
        const existing = await this.docRef.get();
        if (!existing.exists) {
            await this.docRef.set(defaults);
            console.log('[BotRepository] Initialised global bot stats document.');
        }
    }

    async resetAllStats(): Promise<void> {
        const defaults: Partial<BotStats> = {
            commandsRun: 0,
            commandsByName: {},
            messagesSeen: 0,
            guildCount: 0,
            channelCount: 0,
            userCount: 0,
            moviesAdded: 0,
            moviesWatched: 0,
            moviePollsRun: 0,
            tasksAdded: 0,
            taskPollsRun: 0,
            tasksCompleted: 0,
            funStats: { bustinCount: 0, goodbotCount: 0, badbotCount: 0 },
            errorCount: 0,
            lastUpdatedAt: new Date(),
        };

        await this.docRef.update(defaults);
        console.log('[BotRepository] Reset all bot stats');
    }

    async increment(field: keyof BotStats | string, amount = 1): Promise<void> {
        await this.docRef.update({
            [field]: FieldValue.increment(amount),
            lastUpdatedAt: new Date(),
        });
    }

    async incrementCommand(commandName: string): Promise<void> {
        await this.docRef.update({
            commandsRun: FieldValue.increment(1),
            [`commandByName.${commandName}`]: FieldValue.increment(1),
            lastUpdatedAt: new Date(),
        });
    }

    async incrementFunStat(statKey: string): Promise<void> {
        await this.docRef.update({
            [`funStats.${statKey}`]: FieldValue.increment(1),
            lastUpdatedAt: new Date(),
        });
    }

    async incrementErrorCount(): Promise<void> {
        await this.docRef.update({
            errorCount: FieldValue.increment(1),
            lastUpdatedAt: new Date(),
        });
    }

    async updateGuildStats(
        guildCount: number,
        channelCount: number,
        userCount: number
    ): Promise<void> {
        await this.docRef.update({
            guildCount,
            channelCount,
            userCount,
            lastUpdatedAt: new Date(),
        });
    }

    async updateLastUpdated(): Promise<void> {
        await this.docRef.update({
            lastUpdatedAt: new Date(),
        });
    }
}