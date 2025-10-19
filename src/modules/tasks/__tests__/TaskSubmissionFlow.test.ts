import { SubmissionStatus } from '../../../models/TaskSubmission';
import { handleDirectMessage, handleAdminButton, handleRejectionModal } from '../../tasks/TaskInteractions';
import { createTaskServiceHarness, createAdminClientMock } from '../../../tests/mocks/taskMocks';

vi.mock('../../tasks/SubmissionActions', () => ({
  postToAdminChannel: vi.fn().mockResolvedValue(undefined),
  notifyUser: vi.fn().mockResolvedValue(undefined),
  archiveSubmission: vi.fn().mockResolvedValue(undefined),
  updateTaskCounter: vi.fn().mockResolvedValue(undefined),
}));

import * as submissionActions from '../../tasks/SubmissionActions';
const { postToAdminChannel, notifyUser, archiveSubmission, updateTaskCounter } = submissionActions;

vi.mock('../../../utils/ChannelUtils', () => ({
    isTextChannel: (channel: any) => !!channel?.isTextBased?.(),
}));

describe('Task submission lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    describe('Submission creation', () => {
        it('creates, stores, and forwards a submission to the admin channel', async () => {
            const { repo, service } = createTaskServiceHarness({
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

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], 'Nice work');

            expect(postToAdminChannel).toHaveBeenCalledWith(client, expect.objectContaining({
                id: submission.id,
                screenshotUrls: ['https://cdn/img.png'],
                notes: 'Nice work',
            }));

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

            await service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'], 'note');

            const interaction: any = {
                customId: `approve_${submission.id}`,
                user: { id: 'admin-1' },
                client,
                deferReply: vi.fn().mockResolvedValue(undefined),
                editReply: vi.fn().mockResolvedValue(undefined),
                channel: adminChannel,
                message: {
                    embeds: [{ fields: [{ value: '<@user-1>' }, { value: submission.taskName }] }],
                },
            };

            await handleAdminButton(interaction, services);

            expect(repo.updateSubmissionStatus).toHaveBeenCalledWith(submission.id, SubmissionStatus.Approved, 'admin-1');
            expect(archiveSubmission).toHaveBeenCalledWith(client, expect.objectContaining({ status: SubmissionStatus.Approved }));
            expect(notifyUser).toHaveBeenCalledWith(client, expect.objectContaining({ status: SubmissionStatus.Approved }));
            expect(updateTaskCounter).toHaveBeenCalled();
            expect(adminChannel.send).toHaveBeenCalledWith(expect.stringContaining('approved submission'));
        });
    });

    describe('Admin rejection flow', () => {
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
            expect(archiveSubmission).toHaveBeenCalledWith(client, expect.objectContaining({ status: SubmissionStatus.Rejected, rejectionReason: 'Too blurry' }));
            expect(notifyUser).toHaveBeenCalledWith(client, expect.objectContaining({ status: SubmissionStatus.Rejected }));
            expect(adminChannel.send).toHaveBeenCalledWith(expect.stringContaining('Too blurry'));
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
            const { service, repo } = createTaskServiceHarness();
            const { client } = createAdminClientMock();
            const submission = await service.createSubmission('user-1', 'event-1');
            repo.getSubmissionById.mockResolvedValue({ ...submission });
            (postToAdminChannel as vi.Mock).mockRejectedValueOnce(new Error('send failed'));

            await expect(service.completeSubmission(client as any, submission.id, ['https://cdn/img.png'])).rejects.toThrow('send failed');
        });
    });
});
