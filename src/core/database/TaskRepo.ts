import { Timestamp } from "firebase-admin/firestore";
import { GuildScopedRepository } from "./CoreRepo";
import { db } from "./firestore";
import type { Task } from "../../models/Task";
import type { TaskPoll } from "../../models/TaskPoll";
import type { TaskSubmission } from "../../models/TaskSubmission";
import type { TaskEvent } from "../../models/TaskEvent";
import type { TaskFeedback } from "../../models/TaskFeedback";
import type { ITaskRepository } from "./interfaces/ITaskRepo";

export class TaskRepository extends GuildScopedRepository<Task> implements ITaskRepository {
    constructor(guildId: string) {
        super(guildId, 'tasks');
    }

    // Fetch single task by ID
    async getTaskById(id: string): Promise<Task | null> {
        return await this.getById(id);
    }

    // Fetch all tasks
    async getAllTasks(): Promise<Task[]> {
        return await this.getAll();
    }

    // Fetch all tasks of a specific category
    async getTasksByCategory(category: string): Promise<Task[]> {
        const snapshot = await this.collection.where("category", "==", category).get();
        return snapshot.docs.map(doc => doc.data());
    }

    // Get random tasks (optional category filter)
    async getRandomTasks(limit = 3, category?: string): Promise<Task[]> {
        const queryRef = category
            ? this.collection.where("category", "==", category)
            : this.collection;

        const snapshot = await queryRef.get();
        const tasks = snapshot.docs
            .map((doc) => doc.data() as Task)
            .filter((t): t is Task => !!t);

        for (let i = tasks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const ti = tasks[i];
            const tj = tasks[j];
            if (ti && tj) [tasks[i], tasks[j]] = [tj, ti];
        }

        return tasks.slice(0, limit);
    }

    // Increment weighting field
    async incrementWeight(id: string, amount = 1): Promise<void> {
        const docRef = this.collection.doc(id);
        const snap = await docRef.get();
        const current = (snap.data() as Task | undefined)?.weight ?? 0;
        await docRef.update({ weight: current + amount });
    }

    private get pollsCollection() {
        return db.collection(`guilds/${this.guildId}/taskPolls`);
    }

    async createTaskPoll(poll: TaskPoll): Promise<void> {
        await this.pollsCollection.doc(poll.id).set(poll);
    }

    async getActiveTaskPoll(): Promise<TaskPoll | null> {
        const snapshot = await this.pollsCollection
            .where('isActive', '==', true)
            .limit(1)
            .get();

        if (snapshot.empty) return null;
        return snapshot.docs[0]?.data() as TaskPoll;
    }

    async closeTaskPoll(pollId: string): Promise<void> {
        const docRef = this.pollsCollection.doc(pollId);
        await docRef.update({
            isActive: false,
            closedAt: new Date(),
        });
    }

    async clearTaskPolls(): Promise<void> {
        const snapshot = await this.pollsCollection.get();
        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    private get eventsCollection() {
        return db.collection(`guilds/${this.guildId}/taskEvents`);
    }

    async createTaskEvent(event: TaskEvent): Promise<void> {
        await this.eventsCollection.doc(event.id).set(event as any);
    }

    async getLatestTaskEvent(): Promise<TaskEvent | null> {
        const snapshot = await this.eventsCollection
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

        if (snapshot.empty) return null;
        const data = snapshot.docs[0] ? (snapshot.docs[0].data() as unknown as TaskEvent) : null;
        return data;
    }

    private get submissionsCollection() {
        return db.collection(`guilds/${this.guildId}/taskSubmissions`);
    }

    async createSubmission(submission: TaskSubmission): Promise<void> {
        await this.submissionsCollection.doc(submission.id).set(submission);
    }

    async getSubmissionsForTask(taskId: string): Promise<TaskSubmission[]> {
        const snapshot = await this.submissionsCollection.where('taskId', '==', taskId).get();
        return snapshot.docs.map(doc => doc.data() as TaskSubmission);
    }

    async getSubmissionsByUser(userId: string): Promise<TaskSubmission[]> {
        const snapshot = await this.submissionsCollection.where('userId', '==', userId).get();
        return snapshot.docs.map(doc => doc.data() as TaskSubmission);
    }

    async updateSubmissionStatus(
        submissionId: string,
        status: "Pending" | "Approved" | "Rejected",
        reviewedBy: string
    ): Promise<void> {
        const docRef = this.submissionsCollection.doc(submissionId);
        await docRef.update({
            status,
            reviewedBy,
            reviewedAt: Timestamp.now(),
        });
    }

    private get feedbackCollection() {
        return db.collection(`guilds/${this.guildId}/taskFeedback`);
    }

    async addFeedback(feedback: TaskFeedback): Promise<void> {
        await this.feedbackCollection.doc(feedback.id).set(feedback);
    }

    async getFeedbackForTask(taskId: string): Promise<TaskFeedback[]> {
        const snapshot = await this.feedbackCollection.where("taskId", "==", taskId).get();
        return snapshot.docs.map(doc => doc.data() as TaskFeedback);
    }

    async deleteAllTasks(): Promise<void> {
        const snapshot = await this.collection.get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }

    async seedTasks(tasks: Task[]): Promise<void> {
        const batch = db.batch();
        tasks.forEach(task => {
            const ref = this.collection.doc(task.id);
            batch.set(ref, task);
        });
        await batch.commit();
    }
}