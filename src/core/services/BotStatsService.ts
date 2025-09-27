// Temporary service to handle persistent bot stats before Firestore integration
import path from 'path';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import type { BotStats } from '../../models/BotStats';
import { get } from 'http';

const filePath = path.join(process.cwd(), 'src/data', 'botStats.json');

let stats: BotStats;

function loadStats(): BotStats {
    if (existsSync(filePath)) {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            ...parsed,
            funStats: parsed.funStats ?? {
                bustinCount: 0,
                goodbotCount: 0,
                badbotCount: 0,
            }
        }
    } else {
        return {
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
                badbotCount: 0,
            }
        };
    }
}

function saveStats() {
    writeFileSync(filePath, JSON.stringify(stats, null, 2));
}

export const BotStatsService = {
    init() {
        stats = loadStats();
    },
    incrementBustin() {
        stats.funStats.bustinCount = (stats.funStats.bustinCount || 0) + 1;
        stats.lastUpdatedAt = new Date();
        saveStats();
    },
    getStats(): BotStats {
        return stats;
    }
};