import { TaskCategory } from "./Task";

export interface PrizeDraw {
    id: string; // e.g. "2025-09-15_2025-09-29"
    start: string;
    end: string;
    snapshotTakenAt: string;
    taskEventIds?: string[];
    participants: Record<string, number>;
    entries: string[];
    totalEntries: number;

    winners?: Record<TaskCategory, string[]>

    winnerId?: string;
    rolledAt?: string;
}