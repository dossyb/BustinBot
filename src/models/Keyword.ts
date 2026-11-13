export interface Keyword {
    id: string;
    word: string;
    lastUsedEventId?: string;
    lastUsedAt: Date;
    timesUsed: number;
    usageHistory: string[];
}