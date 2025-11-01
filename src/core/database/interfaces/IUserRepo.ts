import type { UserStats } from "../../../models/UserStats";

export interface IUserRepository {
    getAllUsers(): Promise<UserStats[]>;
    getUserById(userId: string): Promise<UserStats | null>;
    createUser(user: UserStats): Promise<void>;
    incrementStat(userId: string, field: keyof UserStats, amount?: number): Promise<void>;
    updateLastActive(userId: string): Promise<void>;
    updateUser(userId: string, data: Partial<UserStats>): Promise<void>;
    deleteUser(userId: string): Promise<void>;
    clearAllUsers(): Promise<void>;
}