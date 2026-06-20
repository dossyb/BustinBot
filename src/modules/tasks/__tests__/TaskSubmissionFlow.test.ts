import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SubmissionStatus } from '../../../models/TaskSubmission.js';
import { handleDirectMessage, handleAdminButton, handleRejectionModal, handleSubmitButton } from '../TaskInteractions.js';
import { createTaskServiceHarness, createAdminClientMock } from '../../../tests/mocks/taskMocks.js';

vi.mock('../../tasks/SubmissionActions', () => ({
  postToAdminChannel: vi.fn().mockResolvedValue(undefined),
  notifyUser: vi.fn().mockResolvedValue(undefined),
  archiveSubmission: vi.fn().mockResolvedValue(undefined),
  updateTaskCounter: vi.fn().mockResolvedValue(undefined),
}));

import * as submissionActions from '../SubmissionActions.js';
const { postToAdminChannel, notifyUser, archiveSubmission, updateTaskCounter } = submissionActions;

const mockedPostToAdminChannel = vi.mocked(postToAdminChannel);
const mockedNotifyUser = vi.mocked(notifyUser);
const mockedArchiveSubmission = vi.mocked(archiveSubmission);
const mockedUpdateTaskCounter = vi.mocked(updateTaskCounter);

vi.mock('../../../utils/ChannelUtils', () => ({
    isTextChannel: (channel: any) => !!channel?.isTextBased?.(),
}));

let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('Task submission lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    });

    afterEach(() => {
        vi.useRealTimers();
        dateNowSpy?.mockRestore();
        dateNowSpy = null;
        mockedPostToAdminChannel.mockClear();
        mockedNotifyUser.mockClear();
        mockedArchiveSubmission.mockClear();
        mockedUpdateTaskCounter.mockClear();
    });

    describe('Submission creation', () => {
        it('defers submit button interactions before loading task event details', async () => {
            const callOrder: string[] = [];
            const { services, repo } = createTaskServiceHarness();
            repo.getTaskEventById.mockImplementation(async () => {
                callOrder.push('getTaskEventById');
                return {
                    id: 'event-1',
                    task: { id: 'task-1', taskName: 'Defeat {amount} dragons' },
                    selectedAmount: 25,
                };
            });

            const interaction: any = {
                customId: 'task-submit-event-1',
                user: {
                    id: 'user-1',
                    send: vi.fn().mockResolvedValue(undefined),
                },
                deferReply: vi.fn().mockImplementation(async () => {
                    callOrder.push('deferReply');
                }),
                editReply: vi.fn().mockResolvedValue(undefined),
            };

            await handleSubmitButton(interaction, services);

            expect(callOrder).toEqual(['deferReply', 'getTaskEventById']);
            expect(interaction.editReply).toHaveBeenCalledWith({
                content: expect.stringContaining('Check your DMs'),
            });
        });

        it('creates, stores, and forwards a submission to the admin channel', async () => {
            const { repo, service, services } = createTaskServiceHarness({
                getTaskEventById: vi.fn().mockResolvedValue({
                    id: 'event-1',
                    task: { id: 'task-1', taskName: 'Defeat {amount} dragons' },
                    selectedAmount: 25,
                }),
            });
            const { client } = createAdminClientMock();

            const submission = await service.createSubmission('user-1', 'event-1');
            expect(submission).toEqual(expect.objectContaining({
                userId: 'user-1',
                taskEventId: 'event-1',
                status: SubmissionStatus.Pending,
                alreadyApproved: false,
                taskName: 'Defeat 25 dragons',
            }));
            expect(repo.createSubmission).toHaveBeenCalledWith(expect.objectContaining({ id: submission.id }));

            repo.getSubmissionById.mockResolvedValue({ ...submission });

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services, 'Nice work');

            expect(mockedPostToAdminChannel).toHaveBeenCalledWith(client, expect.objectContaining({
                id: submission.id,
                screenshotUrls: ['https://cdn/img.png'],
                notes: 'Nice work',
            }), services);

            expect(repo.createSubmission).toHaveBeenCalledTimes(2); // first create + completion update
        });

        it('flags duplicate submissions', async () => {
            const { service, repo } = createTaskServiceHarness();
            repo.getSubmissionsByUser.mockResolvedValueOnce([
                { userId: 'user-1', taskEventId: 'event-1', status: SubmissionStatus.Approved },
            ]);

            const submission = await service.createSubmission('user-1', 'event-1');
            expect(submission.alreadyApproved).toBe(true);
        });
    });

    describe('Admin approval flow', () => {
        it('updates submission status, archives, notifies and increments counters', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel, archiveChannel } = createAdminClientMock();

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services, 'note');

            const interaction: any = {
                customId: `approve_bronze_${submission.id}`,
                user: { id: 'admin-1' },
                client,
                reply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
                message: {
                    embeds: [{ fields: [{ value: '<@user-1>' }, { value: submission.taskName }] }],
                },
            };

            await handleAdminButton(interaction, services);

            expect(interaction.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('approve this submission for **Bronze** tier'),
                })
            );

            const confirmInteraction: any = {
                customId: `review-confirm|approve|bronze|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(confirmInteraction, services);

            expect(repo.updateSubmissionStatus).toHaveBeenCalledWith(submission.id, SubmissionStatus.Bronze, 'admin-1');
            expect(mockedArchiveSubmission).toHaveBeenCalledWith(
                client,
                expect.objectContaining({ status: SubmissionStatus.Bronze }),
                services
            );
            expect(mockedNotifyUser).toHaveBeenCalledWith(
                client,
                expect.objectContaining({ status: SubmissionStatus.Bronze }),
                expect.any(String)
            );
            expect(mockedUpdateTaskCounter).toHaveBeenCalledWith(client, submission.taskEventId, submission.userId, repo, SubmissionStatus.Bronze);
            expect(adminChannel.send).toHaveBeenCalledWith(expect.stringContaining('approved'));
            expect(client.channels.fetch).toHaveBeenCalledWith('task-verification-channel-id');
        });

        it('continues approval flow when archiving fails due to permissions', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            mockedArchiveSubmission.mockRejectedValueOnce(new Error('Missing Permissions'));

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            const interaction: any = {
                customId: `approve_bronze_${submission.id}`,
                user: { id: 'admin-1' },
                client,
                reply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
                message: {
                    embeds: [{ fields: [{ value: '<@user-1>' }, { value: submission.taskName }] }],
                },
            };

            await expect(handleAdminButton(interaction, services)).resolves.not.toThrow();

            const confirmInteraction: any = {
                customId: `review-confirm|approve|bronze|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await expect(handleAdminButton(confirmInteraction, services)).resolves.not.toThrow();

            expect(repo.updateSubmissionStatus).toHaveBeenCalledWith(submission.id, SubmissionStatus.Bronze, 'admin-1');
            expect(mockedArchiveSubmission).toHaveBeenCalled();
            expect(mockedUpdateTaskCounter).toHaveBeenCalledWith(client, submission.taskEventId, submission.userId, repo, SubmissionStatus.Bronze);
            expect(confirmInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('approved') }));
        });

        it('prevents race condition when two admins approve concurrently (admin-1 finishes first)', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            // Admin-1 sends initial approval button
            const admin1Button: any = {
                customId: `approve_bronze_${submission.id}`,
                user: { id: 'admin-1' },
                client,
                reply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
                message: {
                    embeds: [{ fields: [{ value: '<@user-1>' }, { value: submission.taskName }] }],
                },
            };

            await handleAdminButton(admin1Button, services);
            expect(admin1Button.reply).toHaveBeenCalled();

            // Admin-1 confirms approval -> submission becomes Bronze
            const admin1Confirm: any = {
                customId: `review-confirm|approve|bronze|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                update: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(admin1Confirm, services);

            // Now simulate Admin-2 trying to approve the same submission
            // They click the button at nearly the same time as Admin-1
            const admin2Confirm: any = {
                customId: `review-confirm|approve|bronze|${submission.id}`,
                user: { id: 'admin-2' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                update: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            // Simulate the race: when Admin-2's confirmation comes in,
            // the submission is already Bronze status (Admin-1 just finished)
            repo.getSubmissionById.mockResolvedValueOnce({
                ...submission,
                status: SubmissionStatus.Bronze,
                screenshotUrls: ['https://cdn/img.png'],
            });

            await handleAdminButton(admin2Confirm, services);

            // Admin-2 should be rejected with a helpful message
            expect(admin2Confirm.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('already approved at bronze tier or higher'),
                    components: [],
                })
            );

            // Critically: the stats increment should only be called once (for Admin-1)
            expect(repo.updateSubmissionStatus).toHaveBeenCalledTimes(1);
        });

        it('prevents race condition when admin tries to upgrade submission (bronze -> silver)', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            // Original submission already at Bronze tier
            repo.getSubmissionById.mockResolvedValueOnce({
                ...submission,
                status: SubmissionStatus.Bronze,
                screenshotUrls: ['https://cdn/img.png'],
            });

            // Admin tries to upgrade to Silver
            const admin1Confirm: any = {
                customId: `review-confirm|approve|silver|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                update: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(admin1Confirm, services);

            // Should allow upgrade since Silver (tier 2) > Bronze (tier 1)
            expect(admin1Confirm.deferUpdate).toHaveBeenCalled();
            expect(repo.updateSubmissionStatus).toHaveBeenCalled();
        });

        it('rejects downgrade attempts (cannot approve at lower tier)', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            // Original submission already at Gold tier
            repo.getSubmissionById.mockResolvedValueOnce({
                ...submission,
                status: SubmissionStatus.Gold,
                screenshotUrls: ['https://cdn/img.png'],
            });

            // Admin tries to approve at Bronze (lower tier)
            const admin1Confirm: any = {
                customId: `review-confirm|approve|bronze|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                update: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(admin1Confirm, services);

            // Should reject downgrade
            expect(admin1Confirm.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('already approved at gold tier or higher'),
                    components: [],
                })
            );

            // Should not defer or update status
            expect(admin1Confirm.deferUpdate).not.toHaveBeenCalled();
            expect(repo.updateSubmissionStatus).not.toHaveBeenCalled();
        });
    });

    describe('Tier upgrade stat handling', () => {
        it('increments new tier stat on first-time approval', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const userRepo = {
                incrementStat: vi.fn().mockResolvedValue(undefined),
                updateTierStat: vi.fn().mockResolvedValue(undefined),
                getUserById: vi.fn().mockResolvedValue(null),
                updateUser: vi.fn().mockResolvedValue(undefined),
            };
            (services.repos as any).userRepo = userRepo;

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            const confirmInteraction: any = {
                customId: `review-confirm|approve|bronze|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(confirmInteraction, services);

            expect(userRepo.incrementStat).toHaveBeenCalledWith('user-1', 'tasksCompletedBronze', 1);
            expect(userRepo.updateTierStat).not.toHaveBeenCalled();
        });

        it('increments silver stat on first-time silver approval', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const userRepo = {
                incrementStat: vi.fn().mockResolvedValue(undefined),
                updateTierStat: vi.fn().mockResolvedValue(undefined),
                getUserById: vi.fn().mockResolvedValue(null),
                updateUser: vi.fn().mockResolvedValue(undefined),
            };
            (services.repos as any).userRepo = userRepo;

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            const confirmInteraction: any = {
                customId: `review-confirm|approve|silver|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(confirmInteraction, services);

            expect(userRepo.incrementStat).toHaveBeenCalledWith('user-1', 'tasksCompletedSilver', 1);
            expect(userRepo.updateTierStat).not.toHaveBeenCalled();
        });

        it('increments gold stat on first-time gold approval', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const userRepo = {
                incrementStat: vi.fn().mockResolvedValue(undefined),
                updateTierStat: vi.fn().mockResolvedValue(undefined),
                getUserById: vi.fn().mockResolvedValue(null),
                updateUser: vi.fn().mockResolvedValue(undefined),
            };
            (services.repos as any).userRepo = userRepo;

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            const confirmInteraction: any = {
                customId: `review-confirm|approve|gold|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(confirmInteraction, services);

            expect(userRepo.incrementStat).toHaveBeenCalledWith('user-1', 'tasksCompletedGold', 1);
            expect(userRepo.updateTierStat).not.toHaveBeenCalled();
        });

        it('calls updateTierStat to atomically decrement previous and increment new tier on upgrade', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const userRepo = {
                incrementStat: vi.fn().mockResolvedValue(undefined),
                updateTierStat: vi.fn().mockResolvedValue(undefined),
                getUserById: vi.fn().mockResolvedValue(null),
                updateUser: vi.fn().mockResolvedValue(undefined),
            };
            (services.repos as any).userRepo = userRepo;

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            // Simulate existing bronze submission for this user+task
            repo.getSubmissionByUserAndTask.mockResolvedValueOnce({
                ...submission,
                status: SubmissionStatus.Bronze,
                screenshotUrls: ['https://cdn/img.png'],
            });

            const confirmInteraction: any = {
                customId: `review-confirm|approve|silver|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(confirmInteraction, services);

            expect(userRepo.updateTierStat).toHaveBeenCalledWith('user-1', 'tasksCompletedBronze', 'tasksCompletedSilver');
            expect(userRepo.incrementStat).not.toHaveBeenCalled();
        });

        it('does not decrement or increment stats when approval is rejected (same or higher tier)', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const userRepo = {
                incrementStat: vi.fn().mockResolvedValue(undefined),
                updateTierStat: vi.fn().mockResolvedValue(undefined),
                getUserById: vi.fn().mockResolvedValue(null),
                updateUser: vi.fn().mockResolvedValue(undefined),
            };
            (services.repos as any).userRepo = userRepo;

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            // Submission already at gold
            repo.getSubmissionById.mockResolvedValueOnce({
                ...submission,
                status: SubmissionStatus.Gold,
                screenshotUrls: ['https://cdn/img.png'],
            });

            const confirmInteraction: any = {
                customId: `review-confirm|approve|bronze|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                update: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(confirmInteraction, services);

            expect(userRepo.incrementStat).not.toHaveBeenCalled();
            expect(userRepo.updateTierStat).not.toHaveBeenCalled();
        });

        it('uses updateTierStat for bronze to gold upgrade (skipping silver)', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const userRepo = {
                incrementStat: vi.fn().mockResolvedValue(undefined),
                updateTierStat: vi.fn().mockResolvedValue(undefined),
                getUserById: vi.fn().mockResolvedValue(null),
                updateUser: vi.fn().mockResolvedValue(undefined),
            };
            (services.repos as any).userRepo = userRepo;

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            // Simulate existing bronze submission
            repo.getSubmissionByUserAndTask.mockResolvedValueOnce({
                ...submission,
                status: SubmissionStatus.Bronze,
                screenshotUrls: ['https://cdn/img.png'],
            });

            const confirmInteraction: any = {
                customId: `review-confirm|approve|gold|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(confirmInteraction, services);

            expect(userRepo.updateTierStat).toHaveBeenCalledWith('user-1', 'tasksCompletedBronze', 'tasksCompletedGold');
            expect(userRepo.incrementStat).not.toHaveBeenCalled();
        });

        it('uses updateTierStat for silver to gold upgrade', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const userRepo = {
                incrementStat: vi.fn().mockResolvedValue(undefined),
                updateTierStat: vi.fn().mockResolvedValue(undefined),
                getUserById: vi.fn().mockResolvedValue(null),
                updateUser: vi.fn().mockResolvedValue(undefined),
            };
            (services.repos as any).userRepo = userRepo;

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            repo.getSubmissionByUserAndTask.mockResolvedValueOnce({
                ...submission,
                status: SubmissionStatus.Silver,
                screenshotUrls: ['https://cdn/img.png'],
            });

            const confirmInteraction: any = {
                customId: `review-confirm|approve|gold|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(confirmInteraction, services);

            expect(userRepo.updateTierStat).toHaveBeenCalledWith('user-1', 'tasksCompletedSilver', 'tasksCompletedGold');
            expect(userRepo.incrementStat).not.toHaveBeenCalled();
        });

        it('finds bronze submission (not rejected) when user has bronze then rejection then silver upgrade', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const userRepo = {
                incrementStat: vi.fn().mockResolvedValue(undefined),
                updateTierStat: vi.fn().mockResolvedValue(undefined),
                getUserById: vi.fn().mockResolvedValue(null),
                updateUser: vi.fn().mockResolvedValue(undefined),
            };
            (services.repos as any).userRepo = userRepo;

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            // getSubmissionByUserAndTask filters to tier statuses only,
            // so a rejected submission with a later reviewedAt is excluded
            // and the bronze submission is returned instead
            repo.getSubmissionByUserAndTask.mockResolvedValueOnce({
                ...submission,
                status: SubmissionStatus.Bronze,
                screenshotUrls: ['https://cdn/img.png'],
            });

            const confirmInteraction: any = {
                customId: `review-confirm|approve|silver|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(confirmInteraction, services);

            // Must decrement bronze and increment silver atomically
            expect(userRepo.updateTierStat).toHaveBeenCalledWith('user-1', 'tasksCompletedBronze', 'tasksCompletedSilver');
            expect(userRepo.incrementStat).not.toHaveBeenCalled();
        });

        it('treats no prior tier submission as first-time approval even if rejected submissions exist', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const userRepo = {
                incrementStat: vi.fn().mockResolvedValue(undefined),
                updateTierStat: vi.fn().mockResolvedValue(undefined),
                getUserById: vi.fn().mockResolvedValue(null),
                updateUser: vi.fn().mockResolvedValue(undefined),
            };
            (services.repos as any).userRepo = userRepo;

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            // getSubmissionByUserAndTask returns null because only rejected/pending
            // submissions exist (filtered out by status in query)
            repo.getSubmissionByUserAndTask.mockResolvedValueOnce(null);

            const confirmInteraction: any = {
                customId: `review-confirm|approve|bronze|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(confirmInteraction, services);

            // No prior tier — first-time approval, increment only
            expect(userRepo.incrementStat).toHaveBeenCalledWith('user-1', 'tasksCompletedBronze', 1);
            expect(userRepo.updateTierStat).not.toHaveBeenCalled();
        });
    });

    describe('Confirmation prompt dismissal (regression)', () => {
        it('updates the confirmation prompt in-place instead of creating a new ephemeral reply', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services);

            const confirmInteraction: any = {
                customId: `review-confirm|approve|bronze|${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferUpdate: vi.fn().mockResolvedValue(undefined),
                deferReply: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(confirmInteraction, services);

            // Must update existing message, not create a new ephemeral reply
            expect(confirmInteraction.deferUpdate).toHaveBeenCalledTimes(1);
            expect(confirmInteraction.deferReply).not.toHaveBeenCalled();

            // Must clear components so buttons can't be clicked again
            expect(confirmInteraction.editReply).toHaveBeenCalledWith(
                expect.objectContaining({ components: [] })
            );
        });
    });

    describe('Admin rejection flow', () => {
        it('prompts for rejection confirmation before opening the reason modal', async () => {
            const { services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const interaction: any = {
                customId: 'reject_12345',
                user: { id: 'admin-1' },
                client,
                reply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
            };

            await handleAdminButton(interaction, services);

            expect(interaction.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('Are you sure you want to reject this submission?'),
                    flags: 1 << 6,
                })
            );
        });

        it('opens rejection reason modal only after reject confirmation', async () => {
            const { services } = createTaskServiceHarness();
            const { client } = createAdminClientMock();

            const interaction: any = {
                customId: 'review-confirm|reject||12345',
                user: { id: 'admin-1' },
                client,
                showModal: vi.fn().mockResolvedValue(undefined),
            };

            await handleAdminButton(interaction, services);

            expect(interaction.showModal).toHaveBeenCalledTimes(1);
            const modalArg = interaction.showModal.mock.calls[0]?.[0];
            expect(modalArg?.data?.custom_id).toBe('reject_reason_12345');
        });

        it('cancels confirmation without changing submission state', async () => {
            const { services, repo } = createTaskServiceHarness();
            const { client } = createAdminClientMock();

            const interaction: any = {
                customId: 'review-cancel|12345',
                user: { id: 'admin-1' },
                client,
                update: vi.fn().mockResolvedValue(undefined),
            };

            await handleAdminButton(interaction, services);

            expect(interaction.update).toHaveBeenCalledWith({
                content: 'Review action cancelled. No changes were made.',
                components: [],
            });
            expect(repo.updateSubmissionStatus).not.toHaveBeenCalled();
        });

        it('rejects invalid confirmation payloads', async () => {
            const { services, repo } = createTaskServiceHarness();
            const { client } = createAdminClientMock();

            const interaction: any = {
                customId: 'review-confirm||',
                user: { id: 'admin-1' },
                client,
                update: vi.fn().mockResolvedValue(undefined),
            };

            await handleAdminButton(interaction, services);

            expect(interaction.update).toHaveBeenCalledWith({
                content: 'Invalid confirmation payload. Please try again.',
                components: [],
            });
            expect(repo.updateSubmissionStatus).not.toHaveBeenCalled();
        });

        it('rejects invalid approval tier in confirmation payload', async () => {
            const { services, repo } = createTaskServiceHarness();
            const { client } = createAdminClientMock();

            const interaction: any = {
                customId: 'review-confirm|approve|platinum|12345',
                user: { id: 'admin-1' },
                client,
                update: vi.fn().mockResolvedValue(undefined),
            };

            await handleAdminButton(interaction, services);

            expect(interaction.update).toHaveBeenCalledWith({
                content: 'Invalid tier selected for approval.',
                components: [],
            });
            expect(repo.updateSubmissionStatus).not.toHaveBeenCalled();
        });

        it('records rejection, archives, and notifies with reason', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client, adminChannel } = createAdminClientMock();

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            const modalInteraction: any = {
                customId: `reject_reason_${submission.id}`,
                fields: { getTextInputValue: vi.fn().mockReturnValue('Too blurry') },
                user: { id: 'admin-1' },
                client,
                deferReply: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
            };

            await handleRejectionModal(modalInteraction, services);

            expect(repo.updateSubmissionStatus).toHaveBeenCalledWith(submission.id, SubmissionStatus.Rejected, 'admin-1');
            expect(mockedArchiveSubmission).toHaveBeenCalledWith(
                client,
                expect.objectContaining({ status: SubmissionStatus.Rejected, rejectionReason: 'Too blurry' }),
                services
            );
            expect(mockedNotifyUser).toHaveBeenCalledWith(client, expect.objectContaining({ status: SubmissionStatus.Rejected }));
            expect(client.channels.fetch).toHaveBeenCalledWith('task-verification-channel-id');
            expect(adminChannel.send).toHaveBeenCalledWith(expect.stringContaining('Too blurry'));
        });

        it('continues rejection flow when DM sending fails', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client } = createAdminClientMock();

            const submission = await service.createSubmission('user-1', 'event-1');
            const stored = { ...submission, screenshotUrls: ['https://cdn/img.png'] };
            repo.getSubmissionById.mockResolvedValue(stored);

            mockedNotifyUser.mockRejectedValueOnce(new Error('Cannot send messages to this user'));

            const modalInteraction: any = {
                customId: `reject_reason_${submission.id}`,
                fields: { getTextInputValue: vi.fn().mockReturnValue('No proof') },
                user: { id: 'admin-1' },
                client,
                deferReply: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
            };

            await expect(handleRejectionModal(modalInteraction, services)).resolves.not.toThrow();

            expect(repo.updateSubmissionStatus).toHaveBeenCalledWith(submission.id, SubmissionStatus.Rejected, 'admin-1');
            expect(mockedNotifyUser).toHaveBeenCalled();
            expect(mockedArchiveSubmission).toHaveBeenCalledWith(client, expect.objectContaining({ status: SubmissionStatus.Rejected }), services);
            expect(modalInteraction.editReply).toHaveBeenCalledWith({ content: "❌ Submission rejected and archived." });
        });
    });

    describe('Error handling', () => {
        it('rejects direct messages without screenshots', async () => {
            const { services, service } = createTaskServiceHarness();
            const { client } = createAdminClientMock();
            const submission = await service.createSubmission('user-1', 'event-1');
            services.tasks.setPendingTask(submission.userId, submission.taskEventId);

            const message: any = {
                author: { bot: false, id: 'user-1' },
                channel: { type: 1 },
                attachments: new Map(),
                content: '',
                reply: vi.fn().mockResolvedValue(undefined),
            };

            await handleDirectMessage(message, client as any, services);
            expect(message.reply).toHaveBeenCalledWith('Please attach at least one image for your submission.');
        });

        it('propagates repo write failures', async () => {
            const { service } = createTaskServiceHarness({
                createSubmission: vi.fn().mockRejectedValue(new Error('write failed')),
                getTaskEventById: vi.fn().mockResolvedValue({
                    id: 'event-1',
                    task: { id: 'task-1', taskName: 'Test Task {amount}' },
                    selectedAmount: 5,
                }),
            });
            await expect(service.createSubmission('user-1', 'event-1')).rejects.toThrow('write failed');
        });

        it('surfaces Discord send failures during completion for visibility', async () => {
            const { service, repo, services } = createTaskServiceHarness();
            const { client } = createAdminClientMock();
            const submission = await service.createSubmission('user-1', 'event-1');
            repo.getSubmissionById.mockResolvedValue({ ...submission });
            mockedPostToAdminChannel.mockRejectedValueOnce(new Error('send failed'));

            await expect(service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], services)).rejects.toThrow('send failed');
        });
    });
});
