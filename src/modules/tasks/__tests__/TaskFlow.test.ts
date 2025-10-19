import { postTaskPoll } from '../../tasks/HandleTaskPoll';
import { startTaskEvent } from '../../tasks/HandleTaskStart';
import { createGuildClientMock, createTaskRepoMock } from '../../../tests/mocks/taskMocks';

const TASK_USER_ROLE = 'Task User';
const TASK_ADMIN_CHANNEL = 'task-channel';
const GUILD_ID = 'guild-1';
const CHANNEL_ID = 'channel-99';

describe('Task module flows', () => {
    beforeEach(() => {
        process.env.DISCORD_GUILD_ID = GUILD_ID;
        process.env.TASK_CHANNEL_ID = CHANNEL_ID;
        process.env.TASK_USER_ROLE_NAME = TASK_USER_ROLE;
        vi.spyOn(global.Math, 'random').mockReturnValue(0.1);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('postTaskPoll', () => {
        it('posts a poll embed with three tasks and persists the poll metadata', async () => {
            const { client, send } = createGuildClientMock(TASK_USER_ROLE);
            send.mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce({
                    id: 'poll-message',
                    createMessageComponentCollector: vi.fn().mockReturnValue({ on: vi.fn() }),
                });

            const mockRepo = createTaskRepoMock({
                getAllTasks: vi.fn().mockResolvedValue([
                    { id: 't1', taskName: 'Task One {amount}', amounts: [5], shortName: 'One' },
                    { id: 't2', taskName: 'Task Two {amount}', amounts: [10], shortName: 'Two' },
                    { id: 't3', taskName: 'Task Three {amount}', amounts: [15], shortName: 'Three' },
                ]),
            });

            await postTaskPoll(client as any, mockRepo as any);

            expect(mockRepo.getAllTasks).toHaveBeenCalled();
            expect(send).toHaveBeenCalledTimes(2);

            const [, pollCall] = send.mock.calls;
            const pollPayload = pollCall[0];
            expect(pollPayload.embeds).toHaveLength(1);
            expect(pollPayload.components).toHaveLength(1);
            expect(pollPayload.components[0].components).toHaveLength(3);

            expect(mockRepo.createTaskPoll).toHaveBeenCalled();
            const pollArg = mockRepo.createTaskPoll.mock.calls[0][0];
            expect(pollArg.options).toHaveLength(3);
            expect(pollArg.isActive).toBe(true);
            expect(pollArg.messageId).toBe('poll-message');
        });
    });

    describe('startTaskEvent', () => {
        it('closes the poll, posts the event embed, and stores the task event', async () => {
            const { client, send } = createGuildClientMock(TASK_USER_ROLE);
            send.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

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
            };

            const winningTask = {
                id: 'task-b',
                taskName: 'Defeat {amount} dragons',
                amounts: [20],
            };

            const mockTaskRepo = createTaskRepoMock({
                getActiveTaskPoll: vi.fn().mockResolvedValue(pollData),
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
                repos: { taskRepo: mockTaskRepo, prizeRepo: {} },
                taskEvents: mockTaskEvents,
                keywords: mockKeywords,
            };

            await startTaskEvent(client as any, services);

            expect(mockTaskRepo.getActiveTaskPoll).toHaveBeenCalled();
            expect(mockTaskRepo.closeTaskPoll).toHaveBeenCalledWith('poll-1');
            expect(send).toHaveBeenCalledTimes(2);

            const embedCall = send.mock.calls[1]?.[0];
            expect(embedCall).toBeDefined();
            expect(embedCall.embeds[0].description).toContain('Defeat 20 dragons');
            expect(mockTaskEvents.storeTaskEvent).toHaveBeenCalled();

            const storedEvent = mockTaskEvents.storeTaskEvent.mock.calls[0][0];
            expect(storedEvent.task.id).toBe('task-b');
            expect(storedEvent.keyword).toBe('pineapple');
        });
    });
});
