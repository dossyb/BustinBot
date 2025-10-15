import type { BotStats } from "../../../models/BotStats";

export interface IBotRepository {
    getBotStats(): Promise<BotStats | null>;
    initBotStats(defaults: BotStats): Promise<void>;
    increment(field: keyof BotStats | string, amount?: number): Promise<void>;
    incrementCommand(commandName: string): Promise<void>;
    incrementFunStat(statKey: string): Promise<void>;
    updateGuildStats(guildCount: number, channelCount: number, userCount: number): Promise<void>;
    incrementErrorCount(): Promise<void>;
    updateLastUpdated(): Promise<void>;
    resetAllStats(): Promise<void>;
}