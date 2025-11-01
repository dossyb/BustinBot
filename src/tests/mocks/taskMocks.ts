import { SubmissionStatus } from "../../models/TaskSubmission";
import { TaskService } from "../../modules/tasks/TaskService";

type PartialRepo = Partial<ReturnType<typeof createBaseRepo>>;

function createBaseRepo() {
    return {
        getSubmissionsByUser: vi.fn().mockResolvedValue([]),
        getTaskEventById: vi.fn().mockResolvedValue({
            id: "event-1",
            task: { id: "task-1", taskName: "Defeat {amount} dragons" },
            selectedAmount: 10,
        }),
        createSubmission: vi.fn().mockResolvedValue(undefined),
        getSubmissionById: vi.fn(),
        getSubmissionByUserAndTask: vi.fn().mockResolvedValue(null),
        updateSubmissionStatus: vi.fn().mockResolvedValue(undefined),
        getActiveTaskPoll: vi.fn(),
        getActiveEvent: vi.fn(),
        getAllTasks: vi.fn().mockResolvedValue([]),
        createTaskPoll: vi.fn().mockResolvedValue(undefined),
        getTaskById: vi.fn(),
        closeTaskPoll: vi.fn(),
        getActiveTaskPollByCategory: vi.fn().mockResolvedValue(null),
        getLatestTaskPollByCategory: vi.fn().mockResolvedValue(null),
    };
}

export function createTaskRepoMock(overrides: PartialRepo = {}) {
    return { ...createBaseRepo(), ...overrides } as ReturnType<typeof createBaseRepo>;
}

export function createTaskServiceHarness(overrides: PartialRepo = {}) {
  const repo = createTaskRepoMock(overrides);
  const service = new TaskService(repo as any);

  const services = {
    repos: { taskRepo: repo },
    tasks: service,
    // plain object mock is fine; no need to fake the private field
    taskEvents: {
      storeTaskEvent: vi.fn(async () => {}),
      getLatestTaskEvent: vi.fn(async () => null),
    },
    keywords: { selectKeyword: vi.fn().mockResolvedValue("keyword") },
    botStats: {
      init: vi.fn(async () => {}),
      incrementBustin: vi.fn(async () => {}),
      incrementGoodBot: vi.fn(async () => {}),
      incrementBadBot: vi.fn(async () => {}),
      getStats: vi.fn(() => null),
      getGoodBotCount: vi.fn(() => 0),
      getBadBotCount: vi.fn(() => 0),
    } as unknown as import("../../core/services/BotStatsService").BotStatsService,
  } as unknown as import("../../core/services/ServiceContainer").ServiceContainer; // 👈 double-cast here

  return { repo, service, services };
}


export function createGuildClientMock(roleName = "Task User") {
    const send = vi.fn();
    const channel = {
        isTextBased: () => true,
        send,
    };

    const guild = {
        channels: { fetch: vi.fn().mockResolvedValue(channel) },
        roles: { cache: { find: vi.fn().mockReturnValue({ id: "role-id", name: roleName }) } },
    };

    const client: any = {
        guilds: { fetch: vi.fn().mockResolvedValue(guild) },
    };

    return { client, guild, channel, send };
}

export function createAdminClientMock() {
    const adminChannel = {
        name: "task-admin",
        isTextBased: () => true,
        send: vi.fn().mockResolvedValue(undefined),
        messages: {
            fetch: vi.fn().mockResolvedValue({ delete: vi.fn().mockResolvedValue(undefined) }),
        },
    };

    const archiveChannel = {
        name: "bot-archive",
        isTextBased: () => true,
        send: vi.fn().mockResolvedValue(undefined),
    };

    const client: any = {
        channels: {
            cache: {
                find: vi.fn((predicate: (channel: any) => boolean) => {
                    if (predicate(adminChannel)) return adminChannel;
                    if (predicate(archiveChannel)) return archiveChannel;
                    return undefined;
                }),
            },
        },
        users: {
            fetch: vi.fn().mockResolvedValue({ send: vi.fn().mockResolvedValue(undefined) }),
        },
    };

    return { client, adminChannel, archiveChannel };
}

export function buildApprovedSubmission(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: Date.now().toString(),
        userId: "user-1",
        taskEventId: "event-1",
        screenshotUrls: ["https://cdn/img.png"],
        status: SubmissionStatus.Pending,
        createdAt: new Date(),
        alreadyApproved: false,
        taskName: "Defeat 10 dragons",
        ...overrides,
    };
}
