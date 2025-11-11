const cronMockModule = vi.hoisted(() => import("../../../tests/mocks/cronMock.js"));

vi.mock("node-cron", async () => ({
    ...(await cronMockModule),
}));

vi.mock("../HandlePrizeDraw.js", () => ({
    generatePrizeDrawSnapshot: vi.fn().mockResolvedValue({ id: 'snapshot-1' }),
    rollWinnerForSnapshot: vi.fn().mockResolvedValue('winner-1'),
    announcePrizeDrawWinner: vi.fn().mockResolvedValue(true),
}));

import { initTaskScheduler, stopTaskScheduler } from "../TaskScheduler.js";
import { scheduledTasks } from "../../../tests/mocks/cronMock.js";
import {
    generatePrizeDrawSnapshot,
    rollWinnerForSnapshot,
    announcePrizeDrawWinner,
} from "../HandlePrizeDraw.js";

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
        vi.clearAllMocks();
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

        const fakeGetChannel = vi.fn().mockResolvedValue({ send: vi.fn() });
        const fakeGetWeek = vi.fn();

        initTaskScheduler(mockClient, mockServices, fakeGetChannel, fakeGetWeek);

        const prizeTask = scheduledTasks.find(
            (task: any) => task.expression === "0 0 * * 2"
        );
        expect(prizeTask).toBeDefined();

        fakeGetWeek.mockReturnValue(2);
        await prizeTask.callback();
        expect(generatePrizeDrawSnapshot).toHaveBeenCalledTimes(1);
        expect(rollWinnerForSnapshot).toHaveBeenCalledWith(
            mockServices.repos.prizeRepo,
            'snapshot-1',
            mockServices
        );
        expect(announcePrizeDrawWinner).toHaveBeenCalledWith(
            mockClient,
            mockServices,
            mockServices.repos.prizeRepo,
            'snapshot-1'
        );

        fakeGetWeek.mockReturnValue(3);
        vi.clearAllMocks();
        await prizeTask.callback();
        expect(generatePrizeDrawSnapshot).not.toHaveBeenCalled();
        expect(rollWinnerForSnapshot).not.toHaveBeenCalled();
        expect(announcePrizeDrawWinner).not.toHaveBeenCalled();

        fakeGetWeek.mockReset();
    });
});
