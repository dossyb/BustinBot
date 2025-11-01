import { postTaskPollForCategory } from '../HandleTaskPoll.js';
import { startTaskEventForCategory } from '../HandleTaskStart.js';
import { TaskCategory, TaskType } from '../../../models/Task.js';
import * as TaskSelectorModule from '../TaskSelector.js';
import { createTaskRepoMock } from '../../../tests/mocks/taskMocks.js';

const TASK_USER_ROLE = 'Task User';
const TASK_ADMIN_CHANNEL = 'task-channel';
const GUILD_ID = 'guild-1';
const CHANNEL_ID = 'channel-99';

let mathRandomSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('Task module flows', () => {
    beforeEach(() => {
        process.env.DISCORD_GUILD_ID = GUILD_ID;
        process.env.TASK_CHANNEL_ID = CHANNEL_ID;
        process.env.TASK_USER_ROLE_NAME = TASK_USER_ROLE;
        mathRandomSpy = vi.spyOn(global.Math, 'random').mockReturnValue(0.1);
    });

    afterEach(() => {
        mathRandomSpy?.mockRestore();
        mathRandomSpy = null;
        vi.mocked(TaskSelectorModule.selectTasksForCategory).mockClear?.();
    });

    describe('postTaskPollForCategory', () => {
        it('posts a poll embed with three tasks and persists the poll metadata', async () => {
            const send = vi.fn().mockResolvedValue({
                id: 'poll-message',
                createMessageComponentCollector: vi.fn().mockReturnValue({ on: vi.fn() }),
            });

            const channel: any = {
                id: CHANNEL_ID,
                send,
            };

            const tasks = [
                { id: 't1', taskName: 'Task One {amount}', category: TaskCategory.PvM, type: TaskType.KC, amtBronze: 1, amtSilver: 2, amtGold: 3, shortName: 'One' },
                { id: 't2', taskName: 'Task Two {amount}', category: TaskCategory.PvM, type: TaskType.KC, amtBronze: 4, amtSilver: 5, amtGold: 6, shortName: 'Two' },
                { id: 't3', taskName: 'Task Three {amount}', category: TaskCategory.PvM, type: TaskType.KC, amtBronze: 7, amtSilver: 8, amtGold: 9, shortName: 'Three' },
                { id: 't4', taskName: 'Other Task', category: TaskCategory.Skilling, type: TaskType.XP, amtBronze: 1, amtSilver: 1, amtGold: 1 },
            ];

            const mockRepo = createTaskRepoMock({
                getAllTasks: vi.fn().mockResolvedValue(tasks),
            });

            const selectSpy = vi.spyOn(TaskSelectorModule, 'selectTasksForCategory').mockReturnValue(tasks.slice(0, 3) as any);

            const services: any = {
                guildId: GUILD_ID,
                guilds: {
                    get: vi.fn().mockResolvedValue({
                        channels: { taskChannel: CHANNEL_ID },
                        roles: { taskUser: 'role-id' },
                    }),
                },
                repos: { taskRepo: mockRepo, userRepo: { incrementStat: vi.fn() } },
            };

            const client: any = {
                guilds: {
                    fetch: vi.fn().mockResolvedValue({
                        channels: { fetch: vi.fn().mockResolvedValue(channel) },
                        roles: { cache: { get: vi.fn().mockReturnValue({ id: 'role-id' }) } },
                    }),
                },
            };

            await postTaskPollForCategory(client, services, TaskCategory.PvM, channel);

            expect(mockRepo.getAllTasks).toHaveBeenCalled();
            expect(send).toHaveBeenCalledTimes(1);

            const pollPayload = send.mock.calls[0]![0];
            expect(pollPayload.embeds).toHaveLength(1);
            expect(pollPayload.components).toHaveLength(1);
            expect(pollPayload.components[0].components).toHaveLength(3);

            expect(mockRepo.createTaskPoll).toHaveBeenCalled();
            const pollArg = (mockRepo.createTaskPoll as any).mock.calls[0][0];
            expect(pollArg.options).toHaveLength(3);
            expect(pollArg.isActive).toBe(true);
            expect(pollArg.messageId).toBe('poll-message');

            selectSpy.mockRestore();
        });
    });

    describe('startTaskEventForCategory', () => {
        it('closes the poll, posts the event embed, and stores the task event', async () => {
            const send = vi.fn().mockResolvedValue({ id: 'event-message' });
            const channel: any = { id: CHANNEL_ID, send };

            const pollData = {
                id: 'poll-1',
                options: [
                    { id: 'task-a' },
                    { id: 'task-b' },
                ],
                votes: {
                    user1: 'task-b',
                    user2: 'task-b',
                },
                category: TaskCategory.PvM,
            };

            const winningTask = {
                id: 'task-b',
                taskName: 'Defeat {amount} dragons',
                amtBronze: 10,
                amtSilver: 20,
                amtGold: 30,
                category: TaskCategory.PvM,
                type: TaskType.KC,
            };

            const mockTaskRepo = createTaskRepoMock({
                getActiveTaskPollByCategory: vi.fn().mockResolvedValue(null),
                getLatestTaskPollByCategory: vi.fn().mockResolvedValue(pollData),
                getTaskById: vi.fn().mockResolvedValue(winningTask),
                closeTaskPoll: vi.fn().mockResolvedValue(undefined),
            });

            const mockTaskEvents = {
                storeTaskEvent: vi.fn().mockResolvedValue(undefined),
            };

            const mockKeywords = {
                selectKeyword: vi.fn().mockResolvedValue('pineapple'),
            };

            const services: any = {
                guildId: GUILD_ID,
                guilds: {
                    get: vi.fn().mockResolvedValue({
                        channels: { taskChannel: CHANNEL_ID },
                        roles: { taskUser: 'role-id' },
                    }),
                },
                repos: { taskRepo: mockTaskRepo, prizeRepo: {} },
                taskEvents: mockTaskEvents,
                keywords: mockKeywords,
            };

            const client: any = {
                guilds: {
                    fetch: vi.fn().mockResolvedValue({
                        channels: { fetch: vi.fn().mockResolvedValue(channel) },
                        roles: { cache: { get: vi.fn().mockReturnValue({ id: 'role-id' }) } },
                    }),
                },
            };

            await startTaskEventForCategory(client, services, TaskCategory.PvM, 'pineapple', channel);

            expect(mockTaskRepo.getActiveTaskPollByCategory).toHaveBeenCalledWith(TaskCategory.PvM);
            expect(mockTaskRepo.getLatestTaskPollByCategory).toHaveBeenCalledWith(TaskCategory.PvM);
            expect(mockTaskRepo.closeTaskPoll).toHaveBeenCalledWith('poll-1');
            expect(send).toHaveBeenCalledTimes(1);

            const embedCall = send.mock.calls[0]?.[0];
            expect(embedCall).toBeDefined();
            expect(embedCall.embeds[0].data.description).toContain('Defeat');
            expect(mockTaskEvents.storeTaskEvent).toHaveBeenCalled();

            const storedEvent = (mockTaskEvents.storeTaskEvent as any).mock.calls[0][0];
            expect(storedEvent.task.id).toBe('task-b');
            expect(storedEvent.keyword).toBe('pineapple');
        });
    });
});
