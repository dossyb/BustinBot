import type { Poll } from "./Poll.js";
import type { Task, TaskCategory } from "./Task.js";

export interface TaskPoll extends Poll<Task> {
    category: TaskCategory;
}