import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmissionStatus } from '../../../models/TaskSubmission.js';

vi.mock('../TaskEmbeds', () => ({
    buildSubmissionEmbed: vi.fn(() => ({ type: 'submission-embed' })),
    buildArchiveEmbed: vi.fn(() => ({ type: 'archive-embed' })),
    buildTaskEventEmbed: vi.fn(() => ({
        embeds: [{ type: 'task-embed' }],
        components: ['row'],
        files: ['file'],
    })),
}));

vi.mock('../../../utils/ChannelUtils', () => ({
    isTextChannel: (channel: any) => channel?.isTextBased?.() ?? false,
}));

vi.mock('utils/DateUtils', () => ({
    normaliseFirestoreDates: (event: any) => event,
}));

const TaskEmbeds = await import('../TaskEmbeds.js');
const { buildSubmissionEmbed, buildArchiveEmbed, buildTaskEventEmbed } = vi.mocked(TaskEmbeds);

const {
    postToAdminChannel,
    notifyUser,
    archiveSubmission,
    updateTaskCounter,
} = await import('../SubmissionActions.js');

const client = {
    channels: {
        cache: {
            find: vi.fn(),
            get: vi.fn(),
        },
        fetch: vi.fn(),
    },
    users: {
        fetch: vi.fn(),
    },
} as any;

const taskRepo = {
    getTaskEventById: vi.fn(),
    createTaskEvent: vi.fn(),
    getSubmissionsForTask: vi.fn(),
} as any;

const services: any = {
    guildId: 'guild-1',
    repos: { taskRepo },
    guilds: {
        get: vi.fn(),
    },
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('postToAdminChannel', () => {
    it('sends submission embed and screenshots to admin channel', async () => {
        const channelSend = vi.fn()
            .mockResolvedValueOnce({ id: 'msg-1' })
            .mockResolvedValueOnce({ id: 'msg-2' });
        const adminChannel = {
            name: 'task-verification',
            isTextBased: () => true,
            send: channelSend,
        };

        services.guilds.get.mockResolvedValue({
            channels: {
                taskVerification: 'task-verification-channel-id',
            },
        });
        client.channels.fetch.mockResolvedValue(adminChannel);
        taskRepo.getTaskEventById.mockResolvedValue({
            id: 'event-1',
            task: { id: 'task-1', taskName: 'Task One' },
        });

        const submission: any = {
            id: 'sub-1',
            userId: 'user-1',
            taskEventId: 'event-1',
            screenshotUrls: ['https://img/1.png', 'https://img/2.png'],
        };

        await postToAdminChannel(client, submission as any, services);

        expect(buildSubmissionEmbed).toHaveBeenCalled();
        expect(client.channels.fetch).toHaveBeenCalledWith('task-verification-channel-id');
        expect(channelSend).toHaveBeenNthCalledWith(1, {
            embeds: [{ type: 'submission-embed' }],
            components: [expect.anything()],
        });
        expect(channelSend).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                files: submission.screenshotUrls,
            })
        );
        expect(submission.message).toBe('msg-1');
        expect(submission.screenshotMessage).toBe('msg-2');
    });

    it('logs warning and exits when verification channel is not configured', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        services.guilds.get.mockResolvedValue({ channels: {} });

        await expect(
            postToAdminChannel(client, { taskEventId: 'event-1' } as any, services)
        ).resolves.toBeUndefined();

        expect(warnSpy).toHaveBeenCalledWith(
            '[SubmissionActions] Task verification channel not configured for guild guild-1.'
        );
        expect(client.channels.fetch).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('logs warning when channel fetch fails due to permissions', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        services.guilds.get.mockResolvedValue({
            channels: { taskVerification: 'task-verification-channel-id' },
        });
        client.channels.fetch.mockRejectedValueOnce(new Error('Missing Permissions'));
        taskRepo.getTaskEventById.mockResolvedValue({
            id: 'event-1',
            task: { id: 'task-1', taskName: 'Task One' },
        });

        await expect(
            postToAdminChannel(client, { taskEventId: 'event-1' } as any, services)
        ).resolves.toBeUndefined();

        expect(warnSpy).toHaveBeenCalledWith(
            '[SubmissionActions] Unable to resolve task verification channel task-verification-channel-id.'
        );
        warnSpy.mockRestore();
    });
});

describe('notifyUser', () => {
    it('sends success DM when approved', async () => {
        const userSend = vi.fn().mockResolvedValue(undefined);
        client.users.fetch.mockResolvedValue({ send: userSend });

        await notifyUser(client, {
            userId: 'user-1',
            status: SubmissionStatus.Bronze,
            taskName: 'Task',
            prizeRolls: 2,
        } as any);

        expect(client.users.fetch).toHaveBeenCalledWith('user-1');
        expect(userSend).toHaveBeenCalledWith(expect.stringContaining('Bronze'));
    });

    it('sends rejection DM', async () => {
        const userSend = vi.fn().mockResolvedValue(undefined);
        client.users.fetch.mockResolvedValue({ send: userSend });

        await notifyUser(client, {
            userId: 'user-1',
            status: SubmissionStatus.Rejected,
            taskName: 'Task',
            rejectionReason: 'Blurry screenshot',
        } as any);

        expect(userSend).toHaveBeenCalledWith(expect.stringContaining('Blurry screenshot'));
    });
});

describe('archiveSubmission', () => {
    it('archives submission with embed and screenshots', async () => {
        const archiveSend = vi.fn().mockResolvedValue(undefined);
        const archiveChannel = {
            name: 'bot-archive',
            isTextBased: () => true,
            send: archiveSend,
        };

        services.guilds.get.mockResolvedValue({
            channels: {
                botArchive: 'archive-channel-id',
            },
        });
        client.channels.fetch.mockResolvedValue(archiveChannel);

        await archiveSubmission(client, {
            userId: 'user-1',
            taskEventId: 'event-1',
            status: SubmissionStatus.Approved,
            screenshotUrls: ['https://img.png'],
        } as any, services);

        expect(buildArchiveEmbed).toHaveBeenCalled();
        expect(archiveSend).toHaveBeenCalledWith({
            embeds: [{ type: 'archive-embed' }],
        });
        expect(archiveSend).toHaveBeenCalledWith(
            expect.objectContaining({
                files: ['https://img.png'],
            })
        );
    });

    it('logs warning and exits when archive channel missing', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        services.guilds.get.mockResolvedValue({ channels: {} });

        await expect(
            archiveSubmission(client, { taskEventId: 'event-1' } as any, services)
        ).resolves.toBeUndefined();

        expect(warnSpy).toHaveBeenCalledWith(
            '[SubmissionActions] Bot archive channel not configured for guild guild-1.'
        );
        warnSpy.mockRestore();
    });
});

describe('updateTaskCounter', () => {
    it('updates completion counts and edits event message', async () => {
        const event = {
            id: 'event-1',
            task: { taskName: 'Collect Herbs' },
            channelId: 'channel-1',
            messageId: 'message-1',
            completionCounts: { bronze: 0, silver: 0, gold: 0 },
        };

        const messageEdit = vi.fn().mockResolvedValue(undefined);
        const textChannel = {
            isTextBased: () => true,
            messages: { fetch: vi.fn().mockResolvedValue({ edit: messageEdit }) },
        };

        client.channels.cache.get.mockReturnValue(textChannel);

        taskRepo.getTaskEventById.mockResolvedValue(event);
        taskRepo.getSubmissionsForTask.mockResolvedValue([
            { userId: 'user-1', status: SubmissionStatus.Bronze },
        ]);

        await updateTaskCounter(
            client,
            'event-1',
            'user-1',
            taskRepo,
            SubmissionStatus.Silver
        );

        expect(taskRepo.createTaskEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                completionCounts: { bronze: -1, silver: 1, gold: 0 },
            })
        );
        expect(buildTaskEventEmbed).toHaveBeenCalled();
        expect(messageEdit).toHaveBeenCalledWith({
            embeds: [{ type: 'task-embed' }],
            components: ['row'],
            files: ['file'],
        });
    });

    it('logs warning when repository is missing', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await updateTaskCounter(client, 'event-1');

        expect(warnSpy).toHaveBeenCalledWith('[UpdateTaskCounter] Missing repository reference.');
        warnSpy.mockRestore();
    });

    it('logs warning when task channel message cannot be fetched', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const event = {
            id: 'event-1',
            task: { taskName: 'Collect Herbs' },
            channelId: 'channel-1',
            messageId: 'message-1',
            completionCounts: { bronze: 0, silver: 0, gold: 0 },
        };

        taskRepo.getTaskEventById.mockResolvedValue(event);
        taskRepo.getSubmissionsForTask.mockResolvedValue([]);
        client.channels.cache.get.mockReturnValue({
            isTextBased: () => true,
            messages: { fetch: vi.fn().mockRejectedValue(new Error('Missing Permissions')) },
        });

        await updateTaskCounter(client, 'event-1', 'user-1', taskRepo, SubmissionStatus.Bronze);

        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });
});
