import type { Task } from "./Task.js";
import type { TaskSubmission } from "./TaskSubmission.js";
import type { TaskCategory } from "./Task.js";

export interface TaskEvent {
    id: string;

    // Base task template
    task: Task;

    category: TaskCategory;

    // The chosen amount for this event (legacy)
    selectedAmount?: number;

    amounts: {
        bronze: number;
        silver: number;
        gold: number;
    };

    // Keyword chosen for screenshot verification (manual approval)
    keyword: string;

    // When the task event starts
    startTime: Date;

    // When the task event ends
    endTime: Date;

    // Optional metadata about voting and selection process
    votedOptions?: Task[];
    winningOptionId?: number;

    // Submissions made for this task event
    submissions?: TaskSubmission[];

    completionCounts?: {
        bronze: number;
        silver: number;
        gold: number;
    }
    
    completedUserIds?: string[];

    messageId?: string;
    channelId?: string;

    createdAt: Date;
}