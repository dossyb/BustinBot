import type { Task } from "../../../models/Task.js";
import type { TaskPoll } from "../../../models/TaskPoll.js";
import type { TaskSubmission } from "../../../models/TaskSubmission.js";
import type { TaskEvent } from "../../../models/TaskEvent.js";
import type { TaskFeedback } from "../../../models/TaskFeedback.js";
import type { TaskCategory } from "../../../models/Task.js";

export interface ITaskRepository {
    getAllTasks(): Promise<Task[]>;
    getTaskById(id: string): Promise<Task | null>;
    createTask(task: Task): Promise<void>;
    getTasksByCategory(category: string): Promise<Task[]>;
    getRandomTasks(limit?: number, category?: string): Promise<Task[]>;
    incrementWeight(id: string, amount?: number): Promise<void>;

    // Task polls
    createTaskPoll(poll: TaskPoll): Promise<void>;
    getActiveTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null>;
    getLatestTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null>;
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
    getSubmissionByUserAndTask(userId: string, taskEventId: string): Promise<TaskSubmission | null>;
    updateSubmissionStatus(
        submissionId: string,
        status: "pending" | "approved" | "rejected" | "bronze" | "silver" | "gold",
        reviewedBy: string
    ): Promise<void>;

    // Feedback
    addFeedback(feedback: TaskFeedback): Promise<void>;
    getFeedbackForTask(taskId: string, eventId?: string): Promise<TaskFeedback[]>;

    // Utilities
    deleteAllTasks(): Promise<void>;
    seedTasks(tasks: Task[]): Promise<void>;
    voteInPollOnce(pollId: string, userId: string, optionId: string): Promise<{ firstTime: boolean, updatedPoll: TaskPoll; }>;
}