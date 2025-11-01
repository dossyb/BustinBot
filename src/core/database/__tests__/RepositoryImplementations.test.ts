import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseHoist = vi.hoisted(() => {
    const incrementMock = vi.fn((amount: number) => ({ __type: 'increment', amount }));
    const serverTimestampMock = vi.fn(() => 'serverTimestamp');
    const timestampNowMock = vi.fn((): { toMillis: () => number } => ({ toMillis: () => 0 }));
    const timestampFromMillisMock = vi.fn((ms: number) => ({
        toMillis: () => ms,
        toDate: () => new Date(ms),
    }));

    return {
        incrementMock,
        serverTimestampMock,
        timestampNowMock,
        timestampFromMillisMock,
    };
});

vi.mock('firebase-admin/firestore', () => {
    const { incrementMock, serverTimestampMock, timestampNowMock, timestampFromMillisMock } = firebaseHoist;
    return {
        FieldValue: {
            increment: incrementMock,
            serverTimestamp: serverTimestampMock,
        },
        Timestamp: {
            now: timestampNowMock,
            fromMillis: timestampFromMillisMock,
        },
        CollectionReference: class {},
    };
});

const { incrementMock, serverTimestampMock, timestampNowMock, timestampFromMillisMock } = firebaseHoist;

import { db } from '../firestore.js';
import { GuildScopedRepository } from '../CoreRepo.js';
import { BotRepository } from '../BotRepo.js';
import { KeywordRepository } from '../KeywordRepo.js';
import { UserRepository } from '../UserRepo.js';

type FirestoreDoc<T = any> = {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    id?: string;
};

type FirestoreCollection = {
    doc: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    where?: ReturnType<typeof vi.fn>;
    orderBy?: ReturnType<typeof vi.fn>;
    limit?: ReturnType<typeof vi.fn>;
};

const mockDb = vi.mocked(db);

function createDocSnapshot(data: any, exists = true) {
    return {
        exists,
        data: () => data,
        id: data?.id ?? 'doc-id',
        ref: { id: data?.id ?? 'doc-id' },
    };
}

function createQuerySnapshot(docs: any[]) {
    return {
        docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach: (cb: (doc: any) => void) => docs.forEach(cb),
    };
}

function stubCollection(overrides: Partial<FirestoreCollection> = {}) {
    const collection: FirestoreCollection = {
        doc: vi.fn(),
        get: vi.fn(),
        where: vi.fn().mockImplementation(() => collection),
        orderBy: vi.fn().mockImplementation(() => collection),
        limit: vi.fn().mockImplementation(() => collection),
        ...overrides,
    };
    mockDb.collection.mockReturnValue(collection as any);
    return collection;
}

function stubDoc(data: any, exists = true): FirestoreDoc {
    const doc: FirestoreDoc = {
        get: vi.fn().mockResolvedValue(createDocSnapshot(data, exists)),
        set: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        id: data?.id ?? 'doc-id',
    };
    return doc;
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    mockDb.collection.mockReset();
    mockDb.batch?.mockReset?.();
});

describe('GuildScopedRepository base behaviour', () => {
    class TestRepo extends GuildScopedRepository<{ id: string; value: number }> {
        constructor() {
            super('guild-123', 'testCollection');
        }
    }

    it('performs CRUD operations through the underlying collection', async () => {
        const doc = stubDoc({ id: 'abc', value: 1 });
        const collection = stubCollection({
            doc: vi.fn().mockReturnValue(doc),
            get: vi.fn().mockResolvedValue(createQuerySnapshot([createDocSnapshot({ id: 'abc', value: 1 })])),
        });

        const repo = new TestRepo();

        await expect(repo.getAll()).resolves.toEqual([{ id: 'abc', value: 1 }]);
        expect(collection.get).toHaveBeenCalled();

        await expect(repo.getById('abc')).resolves.toEqual({ id: 'abc', value: 1 });
        expect(collection.doc).toHaveBeenCalledWith('abc');

        await repo.create('abc', { id: 'abc', value: 2 });
        expect(doc.set).toHaveBeenCalledWith({ id: 'abc', value: 2 });

        await repo.update('abc', { value: 3 });
        expect(doc.update).toHaveBeenCalledWith({ value: 3 });

        await repo.delete('abc');
        expect(doc.delete).toHaveBeenCalled();
    });
});

describe('BotRepository', () => {
    function setupBotDoc(existing: boolean, data: any = {}) {
        const doc = stubDoc(data, existing);
        stubCollection({ doc: vi.fn().mockReturnValue(doc) });
        return doc;
    }

    it('retrieves bot stats', async () => {
        const expected = { commandsRun: 5 };
        const doc = setupBotDoc(true, expected);
        const repo = new BotRepository();

        await expect(repo.getBotStats()).resolves.toEqual(expected);
        expect(doc.get).toHaveBeenCalled();
    });

    it('initialises stats when missing', async () => {
        const defaults = { commandsRun: 0 } as any;
        const doc = setupBotDoc(false, defaults);
        const repo = new BotRepository();

        await repo.initBotStats(defaults);
        expect(doc.set).toHaveBeenCalledWith(defaults);
    });

    it('resets stats and increments counters', async () => {
        const doc = setupBotDoc(true, {});
        const repo = new BotRepository();

        await repo.resetAllStats();
        expect(doc.update).toHaveBeenCalledWith(expect.objectContaining({
            commandsRun: 0,
            funStats: expect.objectContaining({ bustinCount: 0 }),
        }));

        await repo.increment('commandsRun', 3);
        expect(doc.update).toHaveBeenCalledWith(expect.objectContaining({
            commandsRun: expect.objectContaining({ amount: 3 }),
        }));

        await repo.incrementCommand('stats');
        expect(doc.update).toHaveBeenCalledWith(expect.objectContaining({
            commandsRun: expect.any(Object),
            'commandByName.stats': expect.any(Object),
        }));

        await repo.incrementFunStat('goodbotCount');
        expect(doc.update).toHaveBeenCalledWith(expect.objectContaining({
            'funStats.goodbotCount': expect.any(Object),
        }));

        await repo.incrementErrorCount();
        expect(doc.update).toHaveBeenCalledWith(expect.objectContaining({
            errorCount: expect.any(Object),
        }));
    });

    it('updates guild metrics and timestamps', async () => {
        const doc = setupBotDoc(true, {});
        const repo = new BotRepository();

        await repo.updateGuildStats(5, 10, 20);
        expect(doc.update).toHaveBeenCalledWith(expect.objectContaining({
            guildCount: 5,
            channelCount: 10,
            userCount: 20,
        }));

        await repo.updateLastUpdated();
        expect(doc.update).toHaveBeenCalledWith(expect.objectContaining({
            lastUpdatedAt: expect.any(Date),
        }));
    });
});

describe('KeywordRepository', () => {
    const guildId = 'guild-keywords';

    function setupKeywordCollection(docs: any[] = []) {
        const docStore = new Map<string, ReturnType<typeof stubDoc>>();
        const collection = stubCollection({
            doc: vi.fn((id: string) => {
                if (!docStore.has(id)) {
                    const existing = docs.find((d) => d.id === id);
                    docStore.set(id, stubDoc(existing ?? { id }, Boolean(existing)));
                }
                return docStore.get(id)!;
            }),
            get: vi.fn().mockResolvedValue(createQuerySnapshot(docs.map((d) => createDocSnapshot(d)))),
        });
        return collection;
    }

    it('adds and retrieves keywords', async () => {
        const keywords = [{ id: 'hello_world', word: 'Hello World' }];
        const collection = setupKeywordCollection(keywords);
        const repo = new KeywordRepository(guildId);

        await expect(repo.getAllKeywords()).resolves.toEqual(keywords);
        expect(collection.get).toHaveBeenCalled();

        await repo.addKeyword('New Keyword!');
        expect(collection.doc).toHaveBeenCalledWith('new_keyword');
        const createdDoc = collection.doc.mock.results.at(-1)?.value;
        expect(createdDoc).toBeTruthy();
        expect(createdDoc.set).toHaveBeenCalledWith(expect.objectContaining({
            id: 'new_keyword',
            word: 'New Keyword!',
            timesUsed: 0,
        }));
    });

    it('marks keyword usage and handles missing docs', async () => {
        const existing = {
            id: 'rare',
            word: 'Rare',
            timesUsed: 2,
            usageHistory: ['old'],
            lastUsedAt: { toMillis: () => 100 },
        };
        const doc = stubDoc(existing, true);
        const missingDoc = stubDoc({}, false);

        const collection = stubCollection({
            doc: vi.fn((id: string) => (id === 'rare' ? doc : missingDoc)),
        });

        const repo = new KeywordRepository(guildId);

        timestampNowMock.mockReturnValueOnce({ toMillis: () => 200 });
        await repo.markKeywordUsed('rare', 'event-1');
        expect(doc.update).toHaveBeenCalledWith(expect.objectContaining({
            timesUsed: 3,
            lastUsedEventId: 'event-1',
            usageHistory: ['event-1', 'old'],
        }));

        await repo.markKeywordUsed('missing', 'event-2');
        expect(missingDoc.update).not.toHaveBeenCalled();
    });

    it('picks random eligible keyword excluding recent ones', async () => {
        const keywords = Array.from({ length: 5 }, (_, i) => ({
            id: `kw-${i}`,
            word: `Word ${i}`,
            lastUsedAt: { toMillis: () => 100 - i },
        }));
        const repo = new KeywordRepository(guildId);
        vi.spyOn(repo, 'getAllKeywords').mockResolvedValue(keywords as any);

        vi.spyOn(Math, 'random').mockReturnValue(0);
        await expect(repo.getRandomKeyword(2)).resolves.toEqual(expect.objectContaining({ id: 'kw-2' }));
        (Math.random as any).mockRestore();
    });

    it('resets usage via batch updates', async () => {
        const docs = [createDocSnapshot({ id: 'kw-1' }), createDocSnapshot({ id: 'kw-2' })];
        const collection = setupKeywordCollection([]);
        collection.get.mockResolvedValueOnce(createQuerySnapshot(docs));

        const batchUpdate = vi.fn();
        const batchCommit = vi.fn().mockResolvedValue(undefined);
        mockDb.batch.mockReturnValue({ update: batchUpdate, commit: batchCommit } as any);

        const repo = new KeywordRepository(guildId);
        await repo.resetAllUsage();

        expect(batchUpdate).toHaveBeenCalledTimes(2);
        expect(batchCommit).toHaveBeenCalled();
    });
});

describe('UserRepository', () => {
    const guildId = 'guild-users';

    function setupUserCollection(docs: any[] = []) {
        const docStore = new Map<string, ReturnType<typeof stubDoc>>();
        const collection = stubCollection({
            doc: vi.fn((id: string) => {
                if (!docStore.has(id)) {
                    const existing = docs.find((d) => d.userId === id);
                    docStore.set(id, stubDoc(existing ?? { userId: id }, Boolean(existing)));
                }
                return docStore.get(id)!;
            }),
            get: vi.fn().mockResolvedValue(createQuerySnapshot(docs.map((d) => createDocSnapshot(d)))),
        });
        return collection;
    }

    it('manages user documents and defaults', async () => {
        const collection = setupUserCollection([{ userId: 'user-1', commandsRun: 1 }]);
        const repo = new UserRepository(guildId);

        await expect(repo.getAllUsers()).resolves.toEqual([{ userId: 'user-1', commandsRun: 1 }]);
        await expect(repo.getUserById('user-1')).resolves.toEqual({ userId: 'user-1', commandsRun: 1 });

        await repo.createUser({ userId: 'user-2' } as any);
        const createdDoc = collection.doc.mock.results.at(-1)?.value;
        expect(createdDoc).toBeTruthy();
        expect(createdDoc.set).toHaveBeenCalledWith({ userId: 'user-2' });

        await repo.updateUser('user-1', { commandsRun: 2 });
        expect(collection.doc('user-1').update).toHaveBeenCalledWith({ commandsRun: 2 });

        await repo.deleteUser('user-1');
        expect(collection.doc('user-1').delete).toHaveBeenCalled();
    });

    it('clears all users using batch delete', async () => {
        const docs = [createDocSnapshot({ userId: 'user-1' }), createDocSnapshot({ userId: 'user-2' })];
        const collection = setupUserCollection([]);
        collection.get.mockResolvedValueOnce(createQuerySnapshot(docs));

        const batchDelete = vi.fn();
        const batchCommit = vi.fn().mockResolvedValue(undefined);
        mockDb.batch.mockReturnValue({ delete: batchDelete, commit: batchCommit } as any);

        const repo = new UserRepository(guildId);
        await repo.clearAllUsers();

        expect(batchDelete).toHaveBeenCalledTimes(2);
        expect(batchCommit).toHaveBeenCalled();
    });

    it('increments stats and initialises missing users', async () => {
        const docExists = stubDoc({ userId: 'existing', tasksCompletedBronze: 1 }, true);
        const docMissing = stubDoc({}, false);
        const collection = stubCollection({
            doc: vi.fn((id: string) => (id === 'existing' ? docExists : docMissing)),
        });

        const repo = new UserRepository(guildId);

        await repo.incrementStat('existing', 'tasksCompletedBronze', 2);
        expect(docExists.update).toHaveBeenCalledWith(expect.objectContaining({
            tasksCompletedBronze: expect.objectContaining({ amount: 2 }),
            lastActiveAt: expect.any(Date),
        }));

        await repo.incrementStat('new-user', 'tasksCompletedBronze', 5);
        expect(docMissing.set).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'new-user',
            tasksCompletedBronze: 5,
        }));

        await repo.updateLastActive('existing');
        expect(docExists.update).toHaveBeenCalledWith({ lastActiveAt: expect.any(Date) });
    });
});
