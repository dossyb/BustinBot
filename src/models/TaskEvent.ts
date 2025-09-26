import type { Task } from "./Task";

export interface TaskEvent {
    // Base task template
    task: Task;

    // The chosen amount for this event (resolved from task.amounts, if any)
    selectedAmount?: number;

    // Keyword chosen for screenshot verification (manual approval)
    keyword: string;

    // When the task event starts
    startTime: Date;

    // When the task event ends
    endTime: Date;

    // Optional metadata about voting and selection process
    votedOptions?: Task[];
    winningOptionId?: number;
}