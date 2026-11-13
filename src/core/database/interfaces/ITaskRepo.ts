import type { Task } from "../../../models/Task.js";
import type { TaskPoll } from "../../../models/TaskPoll.js";
import type { TaskSubmission, TaskSubmissionDraft } from "../../../models/TaskSubmission.js";
import type { TaskEvent } from "../../../models/TaskEvent.js";
import type { TaskFeedback } from "../../../models/TaskFeedback.js";
import type { TaskCategory } from "../../../models/Task.js";

export interface ITaskRepository {
    getAllTasks(): Promise<Task[]>;
    getTaskById(id: string): Promise<Task | null>;
    createTask(task: Task): Promise<void>;
    addTask(task: Task): Promise<boolean>;
    getTasksByCategory(category: string): Promise<Task[]>;

    // Task polls
    createTaskPoll(poll: TaskPoll): Promise<void>;
    getTaskPollById(pollId: string): Promise<TaskPoll | null>;
    getActiveTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null>;
    getLatestTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null>;
    updateTaskPollOptions(pollId: string, options: TaskPoll["options"]): Promise<void>;
    closeTaskPoll(pollId: string): Promise<void>;
    clearTaskPolls(): Promise<void>;

    // Task events
    createTaskEvent(event: TaskEvent): Promise<void>;
    getLatestTaskEvent(): Promise<TaskEvent | null>;
    getTaskEventById(id: string): Promise<TaskEvent | null>;
    getTaskEventsBetween(start: Date, end: Date): Promise<TaskEvent[]>;
    updateTaskEventTask(taskEventId: string, task: TaskEvent["task"], amounts: TaskEvent["amounts"]): Promise<void>;
    addCompletedUser(taskEventId: string, userId: string): Promise<void>;

    // Submissions
    createSubmission(submission: TaskSubmission): Promise<void>;
    getSubmissionById(submissionId: string): Promise<TaskSubmission | null>;
    getSubmissionsForTask(taskId: string): Promise<TaskSubmission[]>;
    getSubmissionsByUser(userId: string): Promise<TaskSubmission[]>;
    updateSubmissionStatus(
        submissionId: string,
        status: "pending" | "approved" | "rejected" | "bronze" | "silver" | "gold",
        reviewedBy: string
    ): Promise<boolean>;
    saveSubmissionDraft(draft: TaskSubmissionDraft): Promise<void>;
    getSubmissionDraft(userId: string): Promise<TaskSubmissionDraft | null>;
    deleteSubmissionDraft(userId: string): Promise<void>;
    submitDraft(submission: TaskSubmission): Promise<boolean>;

    // Feedback
    voteOnTaskOnce(feedback: Omit<TaskFeedback, "id">): Promise<TaskFeedback["vote"] | undefined>;
    incrementWeight(id: string, amount?: number): Promise<void>;

    // Utilities
    deleteAllTasks(): Promise<void>;
    seedTasks(tasks: Task[]): Promise<void>;
    voteInPollOnce(pollId: string, userId: string, optionId: string): Promise<{ firstTime: boolean, updatedPoll: TaskPoll; }>;
}
