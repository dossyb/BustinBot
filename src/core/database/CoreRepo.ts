import { GrpcStatus } from "firebase-admin/firestore";
import type { CollectionReference, DocumentData, Firestore, FirestoreDataConverter } from "firebase-admin/firestore";

export abstract class GuildScopedRepository<T extends DocumentData> {
    protected readonly db: Firestore;
    protected guildId: string;
    protected collectionName: string;
    private readonly converter: FirestoreDataConverter<T>;

    constructor(db: Firestore, guildId: string, collectionName: string, converter: FirestoreDataConverter<T>) {
        this.db = db;
        this.guildId = guildId;
        this.collectionName = collectionName;
        this.converter = converter;
    }

    protected get collection(): CollectionReference<T> {
        return this.guildCollection(this.collectionName, this.converter);
    }

    protected guildCollection<U extends DocumentData>(name: string, converter: FirestoreDataConverter<U>): CollectionReference<U> {
        return this.db.collection(`guilds/${this.guildId}/${name}`).withConverter(converter);
    }

    async getAll(): Promise<T[]> {
        const snapshot = await this.collection.get();
        return snapshot.docs.map(doc => doc.data());
    }

    async getById(id: string): Promise<T | null> {
        const doc = await this.collection.doc(id).get();
        return doc.data() ?? null;
    }

    protected async createIfAbsent(id: string, data: T): Promise<boolean> {
        return this.collection.doc(id).create(data).then(() => true, (err: unknown) => {
            if (err instanceof Error && "code" in err && err.code === GrpcStatus.ALREADY_EXISTS) return false;
            throw err;
        });
    }
}