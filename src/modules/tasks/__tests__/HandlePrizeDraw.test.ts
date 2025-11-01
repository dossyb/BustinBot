import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const buildPrizeDrawEmbedMock = vi.hoisted(() =>
    vi.fn(() => ({
        embeds: [{ data: { description: 'mock' } }],
        files: [],
    }))
);

vi.mock('../TaskEmbeds', () => ({
    buildPrizeDrawEmbed: buildPrizeDrawEmbedMock,
}));

import {
    generatePrizeDrawSnapshot,
    rollWinnerForSnapshot,
    announcePrizeDrawWinner,
} from '../HandlePrizeDraw.js';
import { SubmissionStatus } from '../../../models/TaskSubmission.js';

describe('HandlePrizeDraw.generatePrizeDrawSnapshot', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-11-15T12:34:56Z'));
        process.env.PRIZE_PERIOD_DAYS = '5';
    });

    afterEach(() => {
        vi.useRealTimers();
        delete process.env.PRIZE_PERIOD_DAYS;
        vi.clearAllMocks();
    });

    it('filters qualifying submissions, tallies tier counts and persists snapshot', async () => {
        const prizeRepo = {
            createPrizeDraw: vi.fn().mockResolvedValue(undefined),
        };

        const taskRepo = {
            getTaskEventsBetween: vi.fn().mockResolvedValue([
                { id: 'evt-1' },
                { id: 'evt-2' },
            ]),
            getSubmissionsForTask: vi.fn().mockImplementation((eventId: string) => {
                if (eventId === 'evt-1') {
                    return Promise.resolve([
                        { userId: 'alice', status: SubmissionStatus.Approved },
                        { userId: 'alice', status: SubmissionStatus.Bronze },
                        { userId: 'bob', status: SubmissionStatus.Pending },
                    ]);
                }

                return Promise.resolve([
                    { userId: 'carol', status: SubmissionStatus.Silver },
                    { userId: 'dave', status: SubmissionStatus.Gold },
                    { userId: 'erin', status: SubmissionStatus.Rejected },
                ]);
            }),
        };

        const snapshot = await generatePrizeDrawSnapshot(
            prizeRepo as any,
            taskRepo as any
        );

        expect(taskRepo.getTaskEventsBetween).toHaveBeenCalledWith(
            expect.any(Date),
            expect.any(Date)
        );
        expect(taskRepo.getSubmissionsForTask).toHaveBeenCalledTimes(2);

        const persistedSnapshot = prizeRepo.createPrizeDraw.mock.calls[0]?.[0];
        expect(persistedSnapshot).toBeDefined();

        expect(persistedSnapshot?.participants).toEqual({
            alice: 2,
            carol: 1,
            dave: 1,
        });
        expect(persistedSnapshot?.entries).toEqual([
            'alice',
            'alice',
            'carol',
            'dave',
        ]);
        expect(persistedSnapshot?.totalEntries).toBe(4);
        expect(persistedSnapshot?.tierCounts).toEqual({
            bronze: 1,
            silver: 1,
            gold: 1,
        });

        expect(snapshot).toEqual(persistedSnapshot);
    });
});

describe('HandlePrizeDraw.rollWinnerForSnapshot', () => {
    let randomSpy: ReturnType<typeof vi.spyOn> | null = null;

    afterEach(() => {
        randomSpy?.mockRestore();
        randomSpy = null;
        vi.clearAllMocks();
    });

    it('returns null when there are no tickets', async () => {
        const prizeRepo = {
            getPrizeDrawById: vi.fn().mockResolvedValue({
                id: 'snap-1',
                participants: {},
                totalEntries: 0,
            }),
            setWinners: vi.fn(),
        };
        const services = { repos: { userRepo: { incrementStat: vi.fn() } } };

        const result = await rollWinnerForSnapshot(
            prizeRepo as any,
            'snap-1',
            services as any
        );

        expect(result).toBeNull();
        expect(prizeRepo.setWinners).not.toHaveBeenCalled();
        expect(services.repos.userRepo.incrementStat).not.toHaveBeenCalled();
    });

    it('short-circuits if a winner already exists', async () => {
        const prizeRepo = {
            getPrizeDrawById: vi.fn().mockResolvedValue({
                id: 'snap-2',
                participants: { alice: 1 },
                totalEntries: 1,
                winnerId: 'alice',
            }),
            setWinners: vi.fn(),
        };
        const services = { repos: { userRepo: { incrementStat: vi.fn() } } };

        const result = await rollWinnerForSnapshot(
            prizeRepo as any,
            'snap-2',
            services as any
        );

        expect(result).toBe('alice');
        expect(prizeRepo.setWinners).not.toHaveBeenCalled();
        expect(services.repos.userRepo.incrementStat).not.toHaveBeenCalled();
    });

    it('selects a winner, persists it, and increments stats', async () => {
        randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.95);

        const snapshot = {
            id: 'snap-3',
            participants: { alice: 2, bob: 1 },
            totalEntries: 3,
        } as any;

        const prizeRepo = {
            getPrizeDrawById: vi.fn().mockResolvedValue(snapshot),
            setWinners: vi.fn().mockResolvedValue(undefined),
        };
        const services = {
            repos: {
                userRepo: {
                    incrementStat: vi.fn().mockResolvedValue(undefined),
                },
            },
        };

        const winner = await rollWinnerForSnapshot(
            prizeRepo as any,
            'snap-3',
            services as any
        );

        expect(winner).toBe('bob');
        expect(snapshot.winnerId).toBe('bob');
        expect(prizeRepo.setWinners).toHaveBeenCalledWith(
            'snap-3',
            expect.any(Object),
            'bob'
        );
        expect(services.repos.userRepo.incrementStat).toHaveBeenCalledWith(
            'bob',
            'taskPrizesWon',
            1
        );
    });
});

describe('HandlePrizeDraw.announcePrizeDrawWinner', () => {
    const snapshot = {
        id: 'snap-announce',
        winnerId: 'winner-1',
        totalEntries: 5,
        participants: { 'winner-1': 2, 'other-1': 3 },
        start: '2025-02-01T00:00:00.000Z',
        end: '2025-02-05T00:00:00.000Z',
        tierCounts: { bronze: 1, silver: 2, gold: 1 },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        buildPrizeDrawEmbedMock.mockReturnValue({
            embeds: [{ data: { description: 'mock embed' } }],
            files: [],
        });
    });

    it('announces winner with role mention, embed and DM', async () => {
        const channelSend = vi.fn().mockResolvedValue(undefined);
        const textChannel = {
            id: 'channel-1',
            name: 'tasks',
            isTextBased: () => true,
            send: channelSend,
        };

        const guild = {
            name: 'Guild Name',
            channels: { fetch: vi.fn().mockResolvedValue(textChannel) },
            roles: { cache: { get: vi.fn().mockReturnValue({ id: 'role-42' }) } },
        };

        const user = { send: vi.fn().mockResolvedValue(undefined), tag: 'Winner#1234' };

        const client = {
            guilds: { fetch: vi.fn().mockResolvedValue(guild) },
            channels: { cache: { find: vi.fn() } },
            users: { fetch: vi.fn().mockResolvedValue(user) },
        };

        const services = {
            guildId: 'guild-1',
            guilds: {
                get: vi.fn().mockResolvedValue({
                    channels: { taskChannel: 'channel-1' },
                    roles: { taskUser: 'role-42' },
                }),
            },
        };

        const prizeRepo = {
            getPrizeDrawById: vi.fn().mockResolvedValue(snapshot),
        };

        const announced = await announcePrizeDrawWinner(
            client as any,
            services as any,
            prizeRepo as any,
            'snap-announce'
        );

        expect(announced).toBe(true);
        expect(prizeRepo.getPrizeDrawById).toHaveBeenCalledWith('snap-announce');

        expect(channelSend).toHaveBeenCalledWith('<@&role-42>');
        expect(channelSend).toHaveBeenCalledWith({
            embeds: [{ data: { description: 'mock embed' } }],
            files: [],
        });
        expect(buildPrizeDrawEmbedMock).toHaveBeenCalledWith(
            'winner-1',
            5,
            2,
            snapshot.start,
            snapshot.end,
            snapshot.tierCounts
        );
        expect(client.users.fetch).toHaveBeenCalledWith('winner-1');
        expect(user.send).toHaveBeenCalledWith(
            expect.stringContaining("Congratulations!")
        );
    });

    it('returns false when guild configuration is missing', async () => {
        const client = {
            guilds: { fetch: vi.fn() },
            channels: { cache: { find: vi.fn() } },
            users: { fetch: vi.fn() },
        };

        const services = {
            guildId: 'guild-1',
            guilds: { get: vi.fn().mockResolvedValue(null) },
        };

        const prizeRepo = {
            getPrizeDrawById: vi.fn().mockResolvedValue(snapshot),
        };

        const result = await announcePrizeDrawWinner(
            client as any,
            services as any,
            prizeRepo as any,
            'snap-announce'
        );

        expect(result).toBe(false);
        expect(client.guilds.fetch).not.toHaveBeenCalled();
    });

    it('falls back to weekly-task channel and tolerates DM failures', async () => {
        const fallbackChannelSend = vi.fn().mockResolvedValue(undefined);
        const fallbackChannel = {
            id: 'channel-fallback',
            name: 'weekly-task',
            isTextBased: () => true,
            send: fallbackChannelSend,
        };

        const guild = {
            name: 'Guild Name',
            channels: { fetch: vi.fn().mockResolvedValue(null) },
            roles: { cache: { get: vi.fn().mockReturnValue(null) } },
        };

        const user = { send: vi.fn().mockRejectedValue(new Error('DMs disabled')) };

        const client = {
            guilds: { fetch: vi.fn().mockResolvedValue(guild) },
            channels: { cache: { find: vi.fn().mockReturnValue(fallbackChannel) } },
            users: { fetch: vi.fn().mockResolvedValue(user) },
        };

        const services = {
            guildId: 'guild-1',
            guilds: {
                get: vi.fn().mockResolvedValue({
                    channels: { taskChannel: 'channel-missing' },
                    roles: {},
                }),
            },
        };

        const prizeRepo = {
            getPrizeDrawById: vi.fn().mockResolvedValue(snapshot),
        };

        const result = await announcePrizeDrawWinner(
            client as any,
            services as any,
            prizeRepo as any,
            'snap-announce'
        );

        expect(result).toBe(true);
        expect(client.channels.cache.find).toHaveBeenCalled();
        expect(fallbackChannelSend).toHaveBeenCalledTimes(2);
        expect(user.send).toHaveBeenCalled();
    });
});
