// tests/setup.ts
import { vi } from "vitest";

// 🔧 define the hoisted mock *factory* first
const firestoreMock = vi.hoisted(() => {
  const createDocSnap = (data: Record<string, unknown> = {}) => ({
    exists: true,
    data: () => ({ ...data }),
    id: data?.id ?? "mock-id",
  });

  const createQuerySnapshot = (docs: any[] = []) => ({
    docs,
    empty: docs.length === 0,
    forEach: (cb: (doc: any) => void) => docs.forEach(cb),
  });

  const createCollectionRef = (path: string) => {
    const collectionRef: any = {
      __path: path,
      doc: vi.fn((id?: string, data: Record<string, unknown> = {}) => {
        const safeId = id || "mock-id";
        return {
          id: safeId,
          set: vi.fn().mockResolvedValue(undefined),
          update: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue(createDocSnap({ id: safeId, ...data })),
          delete: vi.fn().mockResolvedValue(undefined),
        };
      }),
      add: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(createQuerySnapshot()),
      where: vi.fn().mockImplementation(() => collectionRef),
      orderBy: vi.fn().mockImplementation(() => collectionRef),
      limit: vi.fn().mockImplementation(() => collectionRef),
    };
    return collectionRef;
  };

  const batchFactory = () => ({
    set: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  });

  return {
    db: {
      collection: vi.fn((path: string) => createCollectionRef(path)),
      batch: vi.fn(batchFactory),
      runTransaction: vi.fn(async (handler: (tx: any) => Promise<any>) => {
        const tx = {
          get: vi.fn(async (ref: any) => ({
            exists: true,
            data: () => ({ id: ref?.id ?? "poll-id", votes: {} }),
          })),
          set: vi.fn(),
          update: vi.fn(),
        };
        return handler(tx);
      }),
    },
  };
});

// ✅ now call vi.mock normally using that hoisted factory
vi.mock("../src/core/database/firestore", () => firestoreMock);
vi.mock("core/database/firestore", () => firestoreMock);
