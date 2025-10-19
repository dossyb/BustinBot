// tests/setup.ts
import { vi } from "vitest";

// 🔧 define the hoisted mock *factory* first
const firestoreMock = vi.hoisted(() => ({
  db: {
    collection: vi.fn((path: string) => ({
      __path: path,
      doc: vi.fn((id?: string) => {
        const safeId = id || "mock-id";
        return {
          id: safeId,
          set: vi.fn().mockResolvedValue(undefined),
          update: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ id: safeId }) }),
          delete: vi.fn().mockResolvedValue(undefined),
        };
      }),
      add: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({ docs: [] }),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })),
    batch: vi.fn(),
  },
}));

// ✅ now call vi.mock normally using that hoisted factory
vi.mock("../src/core/database/firestore", () => firestoreMock);
