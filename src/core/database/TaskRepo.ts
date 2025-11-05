import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { GuildScopedRepository } from "./CoreRepo.js";
import { db } from "./firestore.js";
import type { Task } from "../../models/Task.js";
import type { TaskPoll } from "../../models/TaskPoll.js";
import type { TaskSubmission } from "../../models/TaskSubmission.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import type { TaskFeedback } from "../../models/TaskFeedback.js";
import type { ITaskRepository } from "./interfaces/ITaskRepo.js";
import type { TaskCategory } from "../../models/Task.js";

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

    async createTask(task: Task): Promise<void> {
        await this.collection.doc(task.id).set(task, { merge: true });
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

    async getActiveTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null> {
        const snapshot = await this.pollsCollection
            .where('category', '==', category)
            .where('isActive', '==', true)
            .limit(1)
            .get();

        if (snapshot.empty) {
            return null;
        }

        const doc = snapshot.docs[0];
        if (!doc?.exists) return null;

        const data = doc.data() as unknown as TaskPoll;

        return {
            ...data,
            id: doc.id,
        };
    }

    async getLatestTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null> {
        const snapshot = await this.pollsCollection
            .where('category', '==', category)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();

        if (snapshot.empty) return null;

        const doc = snapshot.docs[0];
        if (!doc?.exists) return null;

        const data = doc.data() as unknown as TaskPoll;

        return {
            ...data,
            id: doc.id,
        };
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

    async getTaskEventById(id: string): Promise<TaskEvent | null> {
        const doc = await this.eventsCollection.doc(id).get();
        if (!doc.exists) return null;
        return doc.data() as TaskEvent;
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

    async getTaskEventsBetween(start: Date, end: Date): Promise<TaskEvent[]> {
        const snapshot = await this.eventsCollection
            .where("createdAt", ">=", Timestamp.fromDate(start))
            .where("createdAt", "<=", Timestamp.fromDate(end))
            .get();

        return snapshot.docs.map((doc) => doc.data() as TaskEvent);
    }
    async addCompletedUser(taskEventId: string, userId: string): Promise<void> {
        await this.eventsCollection.doc(taskEventId).set(
            {
                completedUserIds: FieldValue.arrayUnion(userId),
            },
            { merge: true }
        );
    }

    async removeCompletedUser(taskEventId: string, userId: string): Promise<void> {
        await this.eventsCollection.doc(taskEventId).set(
            {
                completedUserIds: FieldValue.arrayRemove(userId),
            },
            { merge: true }
        );
    }

    private get submissionsCollection() {
        return db.collection(`guilds/${this.guildId}/taskSubmissions`);
    }

    async createSubmission(submission: TaskSubmission): Promise<void> {
        await this.submissionsCollection.doc(submission.id).set(submission);
    }

    async getSubmissionById(submissionId: string): Promise<TaskSubmission | null> {
        const doc = await this.submissionsCollection.doc(submissionId).get();
        return doc.exists ? (doc.data() as TaskSubmission) : null;
    }

    async getSubmissionsForTask(taskId: string): Promise<TaskSubmission[]> {
        const snapshot = await this.submissionsCollection.where('taskEventId', '==', taskId).get();
        return snapshot.docs.map(doc => doc.data() as TaskSubmission);
    }

    async getSubmissionsByUser(userId: string): Promise<TaskSubmission[]> {
        const snapshot = await this.submissionsCollection.where('userId', '==', userId).get();
        return snapshot.docs.map(doc => doc.data() as TaskSubmission);
    }

    async getSubmissionByUserAndTask(userId: string, taskEventId: string): Promise<TaskSubmission | null> {
        const snapshot = await this.submissionsCollection
            .where('userId', '==', userId)
            .where('taskEventId', '==', taskEventId)
            .orderBy('reviewedAt', 'desc')
            .limit(1)
            .get();

        if (snapshot.empty) return null;

        const doc = snapshot.docs[0];
        if (!doc || !doc.exists) return null;
        return doc.data() as TaskSubmission;
    }

    async updateSubmissionStatus(
        submissionId: string,
        status: "pending" | "approved" | "rejected" | "bronze" | "silver" | "gold",
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

    async getFeedbackForTask(taskId: string, eventId?: string): Promise<TaskFeedback[]> {
    let query = this.feedbackCollection.where('taskId', '==', taskId);
    if (eventId) query = query.where('eventId', '==', eventId);
    const snapshot = await query.get();
    return snapshot.docs.map((d) => d.data() as TaskFeedback);
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

    async voteInPollOnce(pollId: string, userId: string, optionId: string): Promise<{ firstTime: boolean, updatedPoll: TaskPoll; }> {
        const pollRef = this.pollsCollection.doc(pollId);
        return db.runTransaction(async (tx) => {
            const snap = await tx.get(pollRef);
            if (!snap.exists) throw new Error("Poll not found.");
            const poll = snap.data() as TaskPoll;

            poll.votes = poll.votes ?? {};
            const firstTime = !poll.votes[userId];

            poll.votes[userId] = optionId;
            tx.set(pollRef, poll, { merge: true });

            return { firstTime, updatedPoll: poll };
        });
    }
}
