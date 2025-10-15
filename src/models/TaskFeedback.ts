export interface TaskFeedback {
    id: string;
    taskId: number;
    userId: string;
    vote: 'up' | 'down';
}