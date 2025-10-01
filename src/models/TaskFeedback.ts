export interface TaskFeedback {
    taskId: number;
    userId: string;
    vote: 'up' | 'down';
}