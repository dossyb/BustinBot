import { db } from "./firestore.js";
import { CollectionReference } from "firebase-admin/firestore";
import type { DocumentData } from "firebase-admin/firestore";

export abstract class GuildScopedRepository<T extends DocumentData> {
    protected guildId: string;
    protected collectionName: string;

    constructor(guildId: string, collectionName: string) {
        this.guildId = guildId;
        this.collectionName = collectionName;
    }

    protected get collection(): CollectionReference<T> {
        return db.collection(`guilds/${this.guildId}/${this.collectionName}`) as CollectionReference<T>;
    }

    async getAll(): Promise<T[]> {
        const snapshot = await this.collection.get();
        return snapshot.docs.map(doc => doc.data());
    }

    async getById(id: string): Promise<T | null> {
        const doc = await this.collection.doc(id).get();
        return doc.exists ? (doc.data() as T) : null;
    }

    async create(id: string, data: T): Promise<void> {
        await this.collection.doc(id).set(data);
    }

    async update(id: string, data: Partial<T>): Promise<void> {
        await this.collection.doc(id).update(data);
    }

    async delete(id: string): Promise<void> {
        await this.collection.doc(id).delete();
    }
}