import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmissionStatus } from '../../../models/TaskSubmission.js';
import { handleTaskFeedback } from '../HandleTaskFeedback.js';

const interactionBase = () => {
    const editReply = vi.fn().mockResolvedValue(undefined);
    const interaction: any = {
        customId: 'task-feedback|up|task-1|event-1',
        user: { id: 'user-1' },
        deferReply: vi.fn().mockResolvedValue(undefined),
        editReply,
    };
    return { interaction, editReply };
};

const repo = {
    getTaskById: vi.fn(),
    getFeedbackForTask: vi.fn(),
    addFeedback: vi.fn(),
    incrementWeight: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleTaskFeedback', () => {
    it('records first-time upvote', async () => {
        const { interaction, editReply } = interactionBase();
        repo.getTaskById.mockResolvedValue({ id: 'task-1' });
        repo.getFeedbackForTask.mockResolvedValue([]);

        await handleTaskFeedback(interaction as any, repo as any);

        expect(repo.addFeedback).toHaveBeenCalledWith(expect.objectContaining({
            taskId: 'task-1',
            userId: 'user-1',
            vote: 'up',
        }));
        expect(repo.incrementWeight).toHaveBeenCalledWith('task-1', 1);
        expect(editReply).toHaveBeenCalledWith({ content: 'Thanks for your feedback!' });
    });

    it('handles duplicate vote gracefully', async () => {
        const { interaction, editReply } = interactionBase();
        repo.getTaskById.mockResolvedValue({ id: 'task-1' });
        repo.getFeedbackForTask.mockResolvedValue([
            { taskId: 'task-1', userId: 'user-1', vote: 'up' },
        ]);

        await handleTaskFeedback(interaction as any, repo as any);

        expect(repo.incrementWeight).not.toHaveBeenCalledWith('task-1', expect.any(Number));
        expect(editReply).toHaveBeenCalledWith({
            content: expect.stringContaining('already gave this task a 👍'),
        });
    });

    it('updates vote direction and adjusts weight', async () => {
        const { interaction, editReply } = interactionBase();
        interaction.customId = 'task-feedback|down|task-1|event-1';
        repo.getTaskById.mockResolvedValue({ id: 'task-1' });
        repo.getFeedbackForTask.mockResolvedValue([
            { taskId: 'task-1', userId: 'user-1', vote: 'up' },
        ]);

        await handleTaskFeedback(interaction as any, repo as any);

        expect(repo.addFeedback).toHaveBeenCalledWith(expect.objectContaining({
            vote: 'down',
        }));
        expect(repo.incrementWeight).toHaveBeenCalledWith('task-1', -2);
        expect(editReply).toHaveBeenCalledWith({ content: 'Feedback updated!' });
    });

    it('rejects unknown feedback type', async () => {
        const { interaction, editReply } = interactionBase();
        interaction.customId = 'task-feedback|sideways|task-1|event-1';

        await handleTaskFeedback(interaction as any, repo as any);

        expect(editReply).toHaveBeenCalledWith({ content: 'Unknown feedback type.' });
    });
});
