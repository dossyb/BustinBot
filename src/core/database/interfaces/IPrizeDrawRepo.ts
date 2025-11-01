import type { PrizeDraw } from "../../../models/PrizeDraw";
import type { TaskCategory } from "../../../models/Task";

export interface IPrizeDrawRepository {
    createPrizeDraw(draw: PrizeDraw): Promise<void>;
    getAllPrizeDraws(): Promise<PrizeDraw[]>;
    getPrizeDrawById(id: string): Promise<PrizeDraw | null>;
    updateParticipants(drawId: string, participants: Record<string, number>): Promise<void>;
    addEntry(drawId: string, userId: string): Promise<void>;
    setWinners(drawId: string, winners: Record<TaskCategory, string[]>, overallWinnerId?: string): Promise<void>;
    deletePrizeDraw(drawId: string): Promise<void>;
    clearPrizeDraws(): Promise<void>;
}