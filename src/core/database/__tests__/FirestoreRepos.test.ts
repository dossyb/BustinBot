import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { TaskCategory } from "../../../models/Task";

// --- Firestore mocks ---
const fromDateMock = vi.fn((date: Date) => ({ __ts: date }));
const incrementMock = vi.fn((amount: number) => ({ __increment: amount }));
const collectionMock = vi.fn();
const batchMock = vi.fn();

// 🔥 vitest-friendly ESM mocks

vi.mock("../firestore", () => ({
    db: {
        collection: vi.fn((path: string) => collectionMock(path)),
        batch: batchMock,
    },
}));

vi.mock("firebase-admin/firestore", () => ({
    Timestamp: {
        fromDate: (date: Date) => fromDateMock(date),
    },
    FieldValue: {
        increment: (amount: number) => incrementMock(amount),
    },
}));

let TaskRepository: any;
let PrizeDrawRepository: any;
let BotRepository: any;

type DocStub = {
    set: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
};

type CollectionStub = {
    __path: string;
    __docStubs: Map<string, DocStub>;
    __queryCalls: Array<{ field: string; op: string; value: unknown }>;
    __orderByCalls: Array<{ field: string; direction?: string }>;
    __limitCalls: number[];
    __queryResult: { docs: Array<{ data: () => any }> };
    doc: (id: string) => DocStub;
    where: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
};

const collectionStubs: Record<string, CollectionStub> = {};

// --- Mock helpers ---
function createDocStub(): DocStub {
    return {
        set: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue({ exists: false }),
        delete: vi.fn().mockResolvedValue(undefined),
    };
}

interface QueryStub {
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
}

function createQueryStub(parent: CollectionStub): QueryStub {
    const query = {
        where: vi.fn((field: string, op: string, value: unknown) => {
            parent.__queryCalls.push({ field, op, value });
            return query;
        }),
        limit: vi.fn((n: number) => {
            parent.__limitCalls.push(n);
            return query;
        }),
        orderBy: vi.fn((field: string, direction?: string) => {
            const payload: { field: string; direction?: string } = { field };
            if (direction !== undefined) payload.direction = direction;
            parent.__orderByCalls.push(payload);
            return query;
        }),
        get: vi.fn(async () => parent.__queryResult),
    };
    return query;
}

function createCollectionStub(path: string): CollectionStub {
    const stub: CollectionStub = {
        __path: path,
        __docStubs: new Map<string, DocStub>(),
        __queryCalls: [],
        __orderByCalls: [],
        __limitCalls: [],
        __queryResult: { docs: [] },
        doc(id: string) {
            if (!stub.__docStubs.has(id)) {
                stub.__docStubs.set(id, createDocStub());
            }
            return stub.__docStubs.get(id)!;
        },
        where: vi.fn((field: string, op: string, value: unknown) => {
            stub.__queryCalls.push({ field, op, value });
            return stub as any;
        }),
        orderBy: vi.fn((field: string, direction?: string) => {
            const payload: { field: string; direction?: string } = { field };
            if (direction !== undefined) payload.direction = direction;
            stub.__orderByCalls.push(payload);
            return createQueryStub(stub);
        }),
        get: vi.fn(async () => stub.__queryResult),
    };

    return stub;
}

// --- Test setup ---
beforeAll(async () => {
    vi.resetModules();
    TaskRepository = (await import("../TaskRepo")).TaskRepository;
    PrizeDrawRepository = (await import("../PrizeDrawRepo")).PrizeDrawRepository;
    BotRepository = (await import("../BotRepo")).BotRepository;
});

beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(collectionStubs).forEach((k) => delete collectionStubs[k]);
    collectionMock.mockReset();
    batchMock.mockReset();
    fromDateMock.mockReset();
    incrementMock.mockReset();

    collectionMock.mockImplementation((path: string) => {
        if (!collectionStubs[path]) {
            collectionStubs[path] = createCollectionStub(path);
        }
        return collectionStubs[path];
    });
});

// --- Tests ---
describe("TaskRepository Firestore interactions", () => {
    it("writes task polls to guild-scoped collection", async () => {
        const repo = new TaskRepository("guild-123");
        const poll = {
            id: "poll-abc",
            type: "task",
            options: [],
            messageId: "",
            channelId: "channel",
            createdAt: new Date(),
            endsAt: new Date(),
            isActive: true,
            votes: {},
        } as any;

        await repo.createTaskPoll(poll);

        expect(collectionMock).toHaveBeenCalledWith("guilds/guild-123/taskPolls");
        const stub = collectionStubs["guilds/guild-123/taskPolls"];
        expect(stub).toBeDefined();
        const doc = stub?.__docStubs.get("poll-abc");
        expect(doc).toBeDefined();
        expect(doc?.set).toHaveBeenCalledWith(poll);
    });

    it("queries task events between dates with Timestamp filters", async () => {
        const repo = new TaskRepository("guild-123");
        const start = new Date("2025-01-01T00:00:00Z");
        const end = new Date("2025-01-07T00:00:00Z");

        const eventsStub = createCollectionStub("guilds/guild-123/taskEvents");
        eventsStub.__queryResult = {
            docs: [{ data: () => ({ id: "event-1" }) }],
        };
        collectionStubs["guilds/guild-123/taskEvents"] = eventsStub;

        const events = await repo.getTaskEventsBetween(start, end);

        expect(events).toHaveLength(1);
        expect(fromDateMock).toHaveBeenCalledWith(start);
        expect(fromDateMock).toHaveBeenCalledWith(end);

        expect(eventsStub.__queryCalls).toHaveLength(2);
        const [first, second] = eventsStub.__queryCalls;
        expect(first).toMatchObject({ field: "createdAt", op: ">=" });
        expect(second).toMatchObject({ field: "createdAt", op: "<=" });
        expect(first?.value).toEqual(expect.objectContaining({ __ts: start }));
        expect(second?.value).toEqual(expect.objectContaining({ __ts: end }));
    });
});

describe("PrizeDrawRepository Firestore interactions", () => {
    it("updates winners and winnerId in guild prize draw collection", async () => {
        const repo = new PrizeDrawRepository("guild-xyz");
        const prizeStub = createCollectionStub("guilds/guild-xyz/prizeDraws");
        collectionStubs["guilds/guild-xyz/prizeDraws"] = prizeStub;

        const winners: Record<TaskCategory, string[]> = {
            [TaskCategory.Skilling]: [],
            [TaskCategory.PvM]: [],
            [TaskCategory.Minigame]: [],
            [TaskCategory.Misc]: ["user-1"],
            [TaskCategory.Leagues]: [],
        };

        await repo.setWinners("draw-1", winners, "user-1");

        const doc = prizeStub.__docStubs.get("draw-1");
        expect(doc).toBeDefined();
        expect(doc?.update).toHaveBeenCalledWith(
            expect.objectContaining({
                winners,
                winnerId: "user-1",
                rolledAt: expect.any(String),
            })
        );
    });
});

describe("BotRepository Firestore interactions", () => {
    it("increments command counters on the global stats document", async () => {
        const repo = new BotRepository();

        await repo.incrementCommand("support");

        expect(collectionMock).toHaveBeenCalledWith("bot");
        const botCollection = collectionStubs["bot"];
        expect(botCollection).toBeDefined();
        const doc = botCollection?.__docStubs.get("stats");
        expect(doc).toBeDefined();
        expect(doc?.update).toHaveBeenCalled();

        const updatePayload = doc?.update.mock.calls[0]![0];
        expect(incrementMock).toHaveBeenCalledWith(1);
        expect(updatePayload.commandsRun.__increment).toBe(1);
        expect(updatePayload["commandByName.support"].__increment).toBe(1);
        expect(updatePayload.lastUpdatedAt).toBeInstanceOf(Date);
    });
});
