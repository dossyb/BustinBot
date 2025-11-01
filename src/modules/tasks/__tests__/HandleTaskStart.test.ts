import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const buildTaskEventEmbedMock = vi.hoisted(() =>
    vi.fn(() => ({
        embeds: ['embed'],
        components: [],
        files: [],
    }))
);

vi.mock('../TaskEmbeds', () => ({
    buildTaskEventEmbed: buildTaskEventEmbedMock,
}));

import { startTaskEventForCategory } from '../HandleTaskStart';
import { TaskCategory, TaskType } from '../../../models/Task';

describe('HandleTaskStart.startTaskEventForCategory', () => {
    beforeEach(() => {
        buildTaskEventEmbedMock.mockClear();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-01T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('falls back to the latest poll, resolves ties, stores the event, and closes the poll', async () => {
        const poll = {
            id: 'poll-1',
            options: [
                { id: 'task-1' },
                { id: 'task-2' },
            ],
            votes: {
                userA: 'task-1',
                userB: 'task-2',
            },
        };

        const task = {
            id: 'task-1',
            taskName: 'Defeat {amount} dragons',
            category: TaskCategory.PvM,
            type: TaskType.KC,
            amtBronze: 10,
            amtSilver: 20,
            amtGold: 30,
        };

        const taskRepo = {
            getActiveTaskPollByCategory: vi.fn().mockResolvedValue(null),
            getLatestTaskPollByCategory: vi.fn().mockResolvedValue(poll),
            getTaskById: vi.fn().mockResolvedValue(task),
            closeTaskPoll: vi.fn().mockResolvedValue(undefined),
        };

        const taskEvents = {
            storeTaskEvent: vi.fn().mockResolvedValue(undefined),
        };

        const services = {
            guildId: 'guild-1',
            guilds: {
                get: vi.fn().mockResolvedValue({
                    channels: { taskChannel: 'channel-1' },
                }),
            },
            repos: {
                taskRepo,
            },
            taskEvents,
        };

        const sentMessage = { id: 'message-99' };
        const channel = {
            id: 'channel-override',
            send: vi.fn().mockResolvedValue(sentMessage),
        };

        await startTaskEventForCategory(
            {} as any,
            services as any,
            TaskCategory.PvM,
            'shared-key',
            channel as any
        );

        expect(taskRepo.getActiveTaskPollByCategory).toHaveBeenCalledWith(TaskCategory.PvM);
        expect(taskRepo.getLatestTaskPollByCategory).toHaveBeenCalledWith(TaskCategory.PvM);
        expect(taskRepo.getTaskById).toHaveBeenCalledWith('task-1');

        const storedEvent = taskEvents.storeTaskEvent.mock.calls[0]?.[0];
        expect(storedEvent).toBeDefined();
        expect(storedEvent.task.id).toBe('task-1');
        expect(storedEvent.keyword).toBe('shared-key');
        expect(storedEvent.channelId).toBe('channel-override');
        expect(storedEvent.messageId).toBe('message-99');
        expect(storedEvent.amounts).toEqual({
            bronze: 10,
            silver: 20,
            gold: 30,
        });

        const startMs = storedEvent.startTime.getTime();
        const endMs = storedEvent.endTime.getTime();
        expect(endMs - startMs).toBe(7 * 24 * 60 * 60 * 1000);

        expect(buildTaskEventEmbedMock).toHaveBeenCalledWith(
            expect.objectContaining({
                task: expect.objectContaining({ id: 'task-1' }),
                category: TaskCategory.PvM,
            })
        );

        expect(channel.send).toHaveBeenCalledWith({
            embeds: ['embed'],
            components: [],
            files: [],
        });
        expect(taskRepo.closeTaskPoll).toHaveBeenCalledWith('poll-1');
    });
});
