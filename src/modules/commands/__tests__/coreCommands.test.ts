import { beforeEach, describe, expect, it, vi } from 'vitest';

const botStats = {
    incrementGoodBot: vi.fn().mockResolvedValue(undefined),
    getGoodBotCount: vi.fn().mockReturnValue(3),
    incrementBadBot: vi.fn().mockResolvedValue(undefined),
    getBadBotCount: vi.fn().mockReturnValue(2),
};

const services = { botStats } as any;

const { default: goodbot } = await import('../core/goodbot');
const { default: badbot } = await import('../core/badbot');

beforeEach(() => {
    Object.values(botStats).forEach((fn: any) => fn.mockClear?.());
});

describe('core moderation commands', () => {
    it('replies to slash interaction for goodbot', async () => {
        const interaction: any = {
            reply: vi.fn().mockResolvedValue(undefined),
            user: { username: 'PraiseUser' },
        };

        await goodbot.execute({ interaction, services });

        expect(botStats.incrementGoodBot).toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('🥹'));
        expect(interaction.reply.mock.calls[0][0]).toContain('3 time');
    });

    it('replies to slash interaction for badbot', async () => {
        const interaction: any = {
            reply: vi.fn().mockResolvedValue(undefined),
            user: { username: 'CriticUser' },
        };

        await badbot.execute({ interaction, services });

        expect(botStats.incrementBadBot).toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(expect.stringContaining('😞'));
        expect(interaction.reply.mock.calls[0][0]).toContain('2 time');
    });
});
