const cronMockModule = vi.hoisted(() => import("../../../tests/mocks/cronMock.js"));

vi.mock("node-cron", async () => ({
    ...(await cronMockModule),
}));

import { initTaskScheduler, stopTaskScheduler } from "../TaskScheduler.js";
import { scheduledTasks } from "../../../tests/mocks/cronMock.js";

const mockClient: any = {};
const mockServices: any = {
    tasks: {},
    taskEvents: {},
    keywords: {},
    repos: {
        taskRepo: {},
        prizeRepo: {},
    },
};

describe('TaskScheduler production schedules', () => {
    beforeEach(() => {
        scheduledTasks.length = 0;
        process.env.BOT_MODE = 'prod';
    });

    afterEach(() => {
        stopTaskScheduler();
    });

    it('should schedule poll, task start and prize draw at correct UTC times', () => {
        const fakeGetChannel = vi.fn().mockResolvedValue({ send: vi.fn() });
        initTaskScheduler(mockClient, mockServices, fakeGetChannel);

        expect(scheduledTasks.length).toBe(3);
        const [pollJob, taskJob, prizeJob] = scheduledTasks.map((task: any) => task.expression);

        expect(pollJob).toBe('0 0 * * 0');
        expect(taskJob).toBe('0 0 * * 1');
        expect(prizeJob).toBe('0 0 * * 2');
    });

    it("should only run prize draw callback on even weeks", async () => {
        process.env.BOT_MODE = "prod";
        process.env.DISCORD_GUILD_ID = "mockGuild";
        process.env.TASK_CHANNEL_ID = "mockChannel";

        vi.resetModules();
        vi.doMock("node-cron", async () => ({
            ...(await cronMockModule),
        }));

        const mod = await import("../TaskScheduler.js");
        const { initTaskScheduler, stopTaskScheduler } = mod as any;

        const { scheduledTasks } = (await import("node-cron")) as any;

        const fakeChannel = { send: vi.fn() };
        const fakeGetChannel = vi.fn().mockResolvedValue(fakeChannel);
        const fakeGetWeek = vi.fn();

        initTaskScheduler(mockClient, mockServices, fakeGetChannel, fakeGetWeek);

        const prizeTask = scheduledTasks.find(
            (task: any) => task.expression === "0 0 * * 2"
        );
        expect(prizeTask).toBeDefined();

        fakeGetWeek.mockReturnValue(2);
        await prizeTask.callback();
        expect(fakeChannel.send).toHaveBeenCalledWith(
            expect.stringContaining("🏆")
        );

        fakeGetWeek.mockReturnValue(3);
        fakeChannel.send.mockClear();
        await prizeTask.callback();
        expect(fakeChannel.send).not.toHaveBeenCalled();

        stopTaskScheduler();
        fakeGetWeek.mockReset();
    });
});