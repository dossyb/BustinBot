export interface PrizeDraw {
    id: string; // e.g. "2025-09-15_2025-09-29"
    start: string;
    end: string;
    snapshotTakenAt: string;
    participants: Record<string, number>;
    totalEntries: number;
    winnerId?: string;
    rolledAt?: string;
}