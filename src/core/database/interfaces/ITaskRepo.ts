import type { Task } from "../../../models/Task";
import type { TaskPoll } from "../../../models/TaskPoll";
import type { TaskSubmission } from "../../../models/TaskSubmission";
import type { TaskEvent } from "../../../models/TaskEvent";
import type { TaskFeedback } from "../../../models/TaskFeedback";

export interface ITaskRepository {
    getAllTasks(): Promise<Task[]>;
    getTaskById(id: string): Promise<Task | null>;
    getTasksByCategory(category: string): Promise<Task[]>;
    getRandomTasks(limit?: number, category?: string): Promise<Task[]>;
    incrementWeight(id: string, amount?: number): Promise<void>;

    // Task polls
    createTaskPoll(poll: TaskPoll): Promise<void>;
    getActiveTaskPoll(): Promise<TaskPoll | null>;
    closeTaskPoll(pollId: string): Promise<void>;
    clearTaskPolls(): Promise<void>;

    // Task events
    createTaskEvent(event: TaskEvent): Promise<void>;
    getLatestTaskEvent(): Promise<TaskEvent | null>;
    getTaskEventById(id: string): Promise<TaskEvent | null>;
    getTaskEventsBetween(start: Date, end: Date): Promise<TaskEvent[]>;

    // Submissions
    createSubmission(submission: TaskSubmission): Promise<void>;
    getSubmissionById(submissionId: string): Promise<TaskSubmission | null>;
    getSubmissionsForTask(taskId: string): Promise<TaskSubmission[]>;
    getSubmissionsByUser(userId: string): Promise<TaskSubmission[]>;
    updateSubmissionStatus(
        submissionId: string,
        status: "Pending" | "Approved" | "Rejected",
        reviewedBy: string
    ): Promise<void>;

    // Feedback
    addFeedback(feedback: TaskFeedback): Promise<void>;
    getFeedbackForTask(taskId: string): Promise<TaskFeedback[]>;

    // Utilities
    deleteAllTasks(): Promise<void>;
    seedTasks(tasks: Task[]): Promise<void>;
}