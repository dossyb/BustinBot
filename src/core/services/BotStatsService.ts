import type { BotStats } from '../../models/BotStats';
import type { IBotRepository } from '../database/interfaces/IBotRepo';

export class BotStatsService {
    private stats: BotStats | null = null;

    constructor(private repo: IBotRepository) { }

    async init(): Promise<void> {
        const existing = await this.repo.getBotStats();
        if (existing) {
            this.stats = existing;
        } else {
            const defaults: BotStats = {
                startedAt: new Date(),
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
                errorCount: 0,
                lastUpdatedAt: new Date(),
                funStats: {
                    bustinCount: 0,
                    goodbotCount: 0,
                    badbotCount: 0
                }
            };
            await this.repo.initBotStats(defaults);
            this.stats = defaults;
        }
    }

    async incrementBustin(): Promise<void> {
        await this.repo.incrementFunStat('bustinCount');
        if (this.stats) {
            this.stats.funStats.bustinCount++;
            this.stats.lastUpdatedAt = new Date();
        }
        await this.repo.updateLastUpdated();
    }

    async incrementGoodBot(): Promise<void> {
        await this.repo.incrementFunStat('goodbotCount');
        if (this.stats) {
            this.stats.funStats.goodbotCount++;
            this.stats.lastUpdatedAt = new Date();
        }
        await this.repo.updateLastUpdated();
    }

    async incrementBadBot(): Promise<void> {
        await this.repo.incrementFunStat('badbotCount');
        if (this.stats) {
            this.stats.funStats.badbotCount++;
            this.stats.lastUpdatedAt = new Date();
        }
        await this.repo.updateLastUpdated();
    }

    getStats(): BotStats | null {
        return this.stats;
    }

    getGoodBotCount(): number {
        return this.stats?.funStats.goodbotCount ?? 0;
    }

    getBadBotCount(): number {
        return this.stats?.funStats.badbotCount ?? 0;
    }
}