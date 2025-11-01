import type { Timestamp } from "firebase-admin/firestore";

export interface Keyword {
    id: string;
    word: string;
    lastUsedEventId?: string;
    lastUsedAt: Timestamp;
    timesUsed: number;
    usageHistory: string[];
}