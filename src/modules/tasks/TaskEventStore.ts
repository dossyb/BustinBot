import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo";
import type { TaskEvent } from "../../models/TaskEvent";

export class TaskEventStore {
    constructor(private repo: ITaskRepository) {}

    async storeTaskEvent(event: TaskEvent): Promise<void> {
        await this.repo.createTaskEvent(event);
    }

    async getLatestTaskEvent(): Promise<TaskEvent | null> {
        return await this.repo.getLatestTaskEvent();
    }
}