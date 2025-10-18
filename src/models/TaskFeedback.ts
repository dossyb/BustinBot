export interface TaskFeedback {
    id: string;
    taskId: string;
    userId: string;
    vote: 'up' | 'down';
}