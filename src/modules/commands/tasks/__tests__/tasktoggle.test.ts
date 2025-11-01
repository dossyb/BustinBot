import { describe, it, beforeEach, expect, vi } from 'vitest';

import tasktoggle from '../tasktoggle.js';

vi.mock('../../../tasks/TaskScheduler', () => ({
    initTaskScheduler: vi.fn(),
    stopTaskScheduler: vi.fn(),
}));

import { initTaskScheduler, stopTaskScheduler } from '../../../tasks/TaskScheduler.js';

describe('tasktoggle command', () => {
    const guilds = {
        get: vi.fn(),
        updateToggle: vi.fn().mockResolvedValue(undefined),
    };

    const services: any = { guilds };

    beforeEach(() => {
        vi.clearAllMocks();
        guilds.updateToggle.mockResolvedValue(undefined);
    });

    function buildInteraction(initialState: boolean) {
        guilds.get.mockResolvedValueOnce({
            toggles: { taskScheduler: initialState },
        });

        const reply = vi.fn().mockResolvedValue(undefined);

        return {
            guildId: 'guild-123',
            user: { id: 'user-999' },
            client: { tag: 'TestClient' },
            reply,
        } as any;
    }

    it('enables scheduler when currently disabled', async () => {
        const interaction = buildInteraction(false);

        await tasktoggle.execute({ interaction, services });

        expect(guilds.updateToggle).toHaveBeenCalledWith('guild-123', 'toggles.taskScheduler', true, 'user-999');
        expect(initTaskScheduler).toHaveBeenCalledWith(interaction.client, services);
        expect(stopTaskScheduler).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining('enabled') })
        );
    });

    it('disables scheduler when currently enabled', async () => {
        const interaction = buildInteraction(true);

        await tasktoggle.execute({ interaction, services });

        expect(guilds.updateToggle).toHaveBeenCalledWith('guild-123', 'toggles.taskScheduler', false, 'user-999');
        expect(stopTaskScheduler).toHaveBeenCalled();
        expect(initTaskScheduler).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining('disabled') })
        );
    });
});
