import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { GuildScopedRepository } from "./CoreRepo.js";
import type { Task } from "../../models/Task.js";
import type { TaskPoll } from "../../models/TaskPoll.js";
import { SubmissionStatus, type TaskSubmission, type TaskSubmissionDraft } from "../../models/TaskSubmission.js";
import type { TaskEvent } from "../../models/TaskEvent.js";
import type { TaskFeedback } from "../../models/TaskFeedback.js";
import type { ITaskRepository } from "./interfaces/ITaskRepo.js";
import type { TaskCategory } from "../../models/Task.js";
import {
    taskConverter,
    taskEventConverter,
    taskFeedbackConverter,
    taskPollConverter,
    taskSubmissionConverter,
    taskSubmissionDraftConverter,
} from "./converters.js";

export class TaskRepository extends GuildScopedRepository<Task> implements ITaskRepository {
    constructor(db: Firestore, guildId: string) {
        super(db, guildId, "tasks", taskConverter);
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

    async addTask(task: Task): Promise<boolean> {
        return this.createIfAbsent(task.id, task);
    }

    // Fetch all tasks of a specific category
    async getTasksByCategory(category: string): Promise<Task[]> {
        const snapshot = await this.collection.where("category", "==", category).get();
        return snapshot.docs.map(doc => doc.data());
    }

    private get pollsCollection() {
        return this.guildCollection("taskPolls", taskPollConverter);
    }

    async createTaskPoll(poll: TaskPoll): Promise<void> {
        await this.pollsCollection.doc(poll.id).set(poll);
    }

    async getTaskPollById(pollId: string): Promise<TaskPoll | null> {
        const doc = await this.pollsCollection.doc(pollId).get();
        return doc.data() ?? null;
    }

    async getActiveTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null> {
        const snapshot = await this.pollsCollection
            .where("category", "==", category)
            .where("isActive", "==", true)
            .limit(1)
            .get();

        return snapshot.docs[0]?.data() ?? null;
    }

    async getLatestTaskPollByCategory(category: TaskCategory): Promise<TaskPoll | null> {
        const snapshot = await this.pollsCollection
            .where("category", "==", category)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

        return snapshot.docs[0]?.data() ?? null;
    }

    async updateTaskPollOptions(pollId: string, options: TaskPoll["options"]): Promise<void> {
        await this.pollsCollection.doc(pollId).update({ options });
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
        const batch = this.db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    private get eventsCollection() {
        return this.guildCollection("taskEvents", taskEventConverter);
    }

    async createTaskEvent(event: TaskEvent): Promise<void> {
        await this.eventsCollection.doc(event.id).set(event);
    }

    async getTaskEventById(id: string): Promise<TaskEvent | null> {
        const doc = await this.eventsCollection.doc(id).get();
        return doc.data() ?? null;
    }

    async getLatestTaskEvent(): Promise<TaskEvent | null> {
        const snapshot = await this.eventsCollection
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

        return snapshot.docs[0]?.data() ?? null;
    }

    async getTaskEventsBetween(start: Date, end: Date): Promise<TaskEvent[]> {
        const snapshot = await this.eventsCollection
            .where("endTime", ">=", start)
            .where("endTime", "<=", end)
            .get();

        return snapshot.docs.map((doc) => doc.data());
    }
    async updateTaskEventTask(taskEventId: string, task: TaskEvent["task"], amounts: TaskEvent["amounts"]): Promise<void> {
        await this.eventsCollection.doc(taskEventId).update({ task, amounts });
    }
    async addCompletedUser(taskEventId: string, userId: string): Promise<void> {
        await this.eventsCollection.doc(taskEventId).set(
            {
                completedUserIds: FieldValue.arrayUnion(userId),
            },
            { merge: true }
        );
    }

    private get submissionsCollection() {
        return this.guildCollection("taskSubmissions", taskSubmissionConverter);
    }

    private get draftsCollection() {
        return this.guildCollection("taskSubmissionDrafts", taskSubmissionDraftConverter);
    }

    async saveSubmissionDraft(draft: TaskSubmissionDraft): Promise<void> {
        await this.draftsCollection.doc(draft.userId).set(draft);
    }

    async getSubmissionDraft(userId: string): Promise<TaskSubmissionDraft | null> {
        const doc = await this.draftsCollection.doc(userId).get();
        return doc.data() ?? null;
    }

    async deleteSubmissionDraft(userId: string): Promise<void> {
        await this.draftsCollection.doc(userId).delete();
    }

    async submitDraft(submission: TaskSubmission): Promise<boolean> {
        const draftRef = this.draftsCollection.doc(submission.userId);
        return this.db.runTransaction(async (transaction) => {
            const draft = (await transaction.get(draftRef)).data();
            if (draft?.taskEventId !== submission.taskEventId) return false;

            transaction.create(this.submissionsCollection.doc(submission.id), submission);
            transaction.delete(draftRef);
            return true;
        });
    }

    async createSubmission(submission: TaskSubmission): Promise<void> {
        await this.submissionsCollection.doc(submission.id).set(submission);
    }

    async getSubmissionById(submissionId: string): Promise<TaskSubmission | null> {
        const doc = await this.submissionsCollection.doc(submissionId).get();
        return doc.data() ?? null;
    }

    async getSubmissionsForTask(taskId: string): Promise<TaskSubmission[]> {
        const snapshot = await this.submissionsCollection.where("taskEventId", "==", taskId).get();
        return snapshot.docs.map(doc => doc.data());
    }

    async getSubmissionsByUser(userId: string): Promise<TaskSubmission[]> {
        const snapshot = await this.submissionsCollection.where("userId", "==", userId).get();
        return snapshot.docs.map(doc => doc.data());
    }

    async updateSubmissionStatus(
        submissionId: string,
        status: "pending" | "approved" | "rejected" | "bronze" | "silver" | "gold",
        reviewedBy: string
    ): Promise<boolean> {
        const docRef = this.submissionsCollection.doc(submissionId);
        return this.db.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            if (snap.data()?.status !== SubmissionStatus.Pending) return false;

            tx.update(docRef, {
                status,
                reviewedBy,
                reviewedAt: Timestamp.now(),
            });
            return true;
        });
    }

    private get feedbackCollection() {
        return this.guildCollection("taskFeedback", taskFeedbackConverter);
    }

    async voteOnTaskOnce(feedback: Omit<TaskFeedback, "id">): Promise<TaskFeedback["vote"] | undefined> {
        const { taskId, userId } = feedback;
        const voteRef = this.feedbackCollection.doc(`${taskId}_${userId}`);

        return this.db.runTransaction(async (transaction) => {
            const stored = await transaction.get(voteRef);
            const older = stored.exists
                ? []
                : (await transaction.get(this.feedbackCollection.where("taskId", "==", taskId).where("userId", "==", userId))).docs;
            const previous = stored.data()?.vote ?? older[0]?.data().vote;

            transaction.set(voteRef, { ...feedback, id: voteRef.id });
            for (const old of older) transaction.delete(old.ref);
            return previous;
        });
    }

    async incrementWeight(id: string, amount = 1): Promise<void> {
        await this.collection.doc(id).update({ weight: FieldValue.increment(amount) });
    }

    async deleteAllTasks(): Promise<void> {
        const snapshot = await this.collection.get();
        const batch = this.db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }

    async seedTasks(tasks: Task[]): Promise<void> {
        const batch = this.db.batch();
        for (const task of tasks) batch.set(this.collection.doc(task.id), task);
        await batch.commit();
    }

    async voteInPollOnce(pollId: string, userId: string, optionId: string): Promise<{ firstTime: boolean, updatedPoll: TaskPoll; }> {
        const pollRef = this.pollsCollection.doc(pollId);
        return this.db.runTransaction(async (tx) => {
            const snap = await tx.get(pollRef);
            const poll = snap.data();
            if (!poll) throw new Error("Poll not found.");

            poll.votes = poll.votes ?? {};
            const firstTime = !poll.votes[userId];

            poll.votes[userId] = optionId;
            tx.set(pollRef, poll, { merge: true });

            return { firstTime, updatedPoll: poll };
        });
    }
}
