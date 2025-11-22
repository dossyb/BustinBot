import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePrizeDrawSnapshot } from '../HandlePrizeDraw.js';
import { SubmissionStatus } from '../../../models/TaskSubmission.js';

describe('Prize Roll - Ensure Correct Roll Counts', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-11-15T12:34:56Z'));
        process.env.PRIZE_PERIOD_DAYS = '14';
    });

    afterEach(() => {
        vi.useRealTimers();
        delete process.env.PRIZE_PERIOD_DAYS;
        vi.clearAllMocks();
    });

    it('User gets 3 rolls max per task when submitting Bronze -> Silver -> Gold', async () => {
        const prizeRepo = {
            createPrizeDraw: vi.fn().mockResolvedValue(undefined),
        };

        const taskRepo = {
            getTaskEventsBetween: vi.fn().mockResolvedValue([
                { id: 'pvm-event', endTime: new Date('2025-11-13T00:00:00Z') },
            ]),
            getSubmissionsForTask: vi.fn().mockResolvedValue([
                // User submitted 3 times for the SAME task, upgrading each time
                { userId: 'user1', taskEventId: 'pvm-event', status: SubmissionStatus.Bronze, prizeRolls: 1 },
                { userId: 'user1', taskEventId: 'pvm-event', status: SubmissionStatus.Silver, prizeRolls: 2 },
                { userId: 'user1', taskEventId: 'pvm-event', status: SubmissionStatus.Gold, prizeRolls: 3 },
            ]),
        };

        await generatePrizeDrawSnapshot(
            prizeRepo as any,
            taskRepo as any
        );

        const persistedSnapshot = prizeRepo.createPrizeDraw.mock.calls[0]?.[0];
        
        // **Should** only count Gold submission (3 rolls), not 1+2+3=6
        expect(persistedSnapshot?.participants).toEqual({ user1: 3 });
        expect(persistedSnapshot?.totalEntries).toBe(3);
    });

    it('User gets 9 rolls total (3 per category) when submitting Bronze -> Silver -> Gold for each', async () => {
        const prizeRepo = {
            createPrizeDraw: vi.fn().mockResolvedValue(undefined),
        };

        const taskRepo = {
            getTaskEventsBetween: vi.fn().mockResolvedValue([
                { id: 'pvm-event', endTime: new Date('2025-11-13T00:00:00Z') },
                { id: 'skilling-event', endTime: new Date('2025-11-13T00:00:00Z') },
                { id: 'minigame-event', endTime: new Date('2025-11-13T00:00:00Z') },
            ]),
            getSubmissionsForTask: vi.fn().mockImplementation((eventId: string) => {
                if (eventId === 'pvm-event') {
                    return Promise.resolve([
                        { userId: 'user1', taskEventId: 'pvm-event', status: SubmissionStatus.Bronze, prizeRolls: 1 },
                        { userId: 'user1', taskEventId: 'pvm-event', status: SubmissionStatus.Silver, prizeRolls: 2 },
                        { userId: 'user1', taskEventId: 'pvm-event', status: SubmissionStatus.Gold, prizeRolls: 3 },
                    ]);
                }
                if (eventId === 'skilling-event') {
                    return Promise.resolve([
                        { userId: 'user1', taskEventId: 'skilling-event', status: SubmissionStatus.Bronze, prizeRolls: 1 },
                        { userId: 'user1', taskEventId: 'skilling-event', status: SubmissionStatus.Silver, prizeRolls: 2 },
                        { userId: 'user1', taskEventId: 'skilling-event', status: SubmissionStatus.Gold, prizeRolls: 3 },
                    ]);
                }
                if (eventId === 'minigame-event') {
                    return Promise.resolve([
                        { userId: 'user1', taskEventId: 'minigame-event', status: SubmissionStatus.Bronze, prizeRolls: 1 },
                        { userId: 'user1', taskEventId: 'minigame-event', status: SubmissionStatus.Silver, prizeRolls: 2 },
                        { userId: 'user1', taskEventId: 'minigame-event', status: SubmissionStatus.Gold, prizeRolls: 3 },
                    ]);
                }
                return Promise.resolve([]);
            }),
        };

        await generatePrizeDrawSnapshot(
            prizeRepo as any,
            taskRepo as any
        );

        const persistedSnapshot = prizeRepo.createPrizeDraw.mock.calls[0]?.[0];
        
        // *SHOULD* deduplicate and only count highest tier per task
        expect(persistedSnapshot?.participants).toEqual({ user1: 9 });
        expect(persistedSnapshot?.totalEntries).toBe(9);
    });

    it('User should only get 9 rolls max (3 per category) when submitting for all categories', async () => {
        const prizeRepo = {
            createPrizeDraw: vi.fn().mockResolvedValue(undefined),
        };

        const taskRepo = {
            getTaskEventsBetween: vi.fn().mockResolvedValue([
                { id: 'pvm-event', endTime: new Date('2025-11-13T00:00:00Z') },
                { id: 'skilling-event', endTime: new Date('2025-11-13T00:00:00Z') },
                { id: 'minigame-event', endTime: new Date('2025-11-13T00:00:00Z') },
            ]),
            getSubmissionsForTask: vi.fn().mockImplementation((eventId: string) => {
                // This simulates what SHOULD happen - only ONE submission per user per task
                if (eventId === 'pvm-event') {
                    return Promise.resolve([
                        { userId: 'user1', taskEventId: 'pvm-event', status: SubmissionStatus.Gold, prizeRolls: 3 },
                    ]);
                }
                if (eventId === 'skilling-event') {
                    return Promise.resolve([
                        { userId: 'user1', taskEventId: 'skilling-event', status: SubmissionStatus.Gold, prizeRolls: 3 },
                    ]);
                }
                if (eventId === 'minigame-event') {
                    return Promise.resolve([
                        { userId: 'user1', taskEventId: 'minigame-event', status: SubmissionStatus.Gold, prizeRolls: 3 },
                    ]);
                }
                return Promise.resolve([]);
            }),
        };

        await generatePrizeDrawSnapshot(
            prizeRepo as any,
            taskRepo as any
        );

        const persistedSnapshot = prizeRepo.createPrizeDraw.mock.calls[0]?.[0];
        
        expect(persistedSnapshot?.participants).toEqual({ user1: 9 });
        expect(persistedSnapshot?.totalEntries).toBe(9);
    });
});