export interface TaskFeedback {
    id: string;
    taskId: string;
    eventId: string;
    userId: string;
    vote: 'up' | 'down';
}