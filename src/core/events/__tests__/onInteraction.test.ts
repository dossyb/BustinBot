import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandModule, CommandRole } from '../../../models/Command.js';
import { handleInteraction } from '../onInteraction.js';

const createBaseInteraction = () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockImplementation(async () => {
        interaction.deferred = true;
    });
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);

    const interaction = {
        isChatInputCommand: () => true,
        isButton: () => false,
        commandName: 'ping',
        guildId: 'guild-123',
        member: {
            user: { id: 'user-1' },
            roles: ['role-1'],
            permissions: '0',
        },
        user: { id: 'user-1', username: 'Tester' },
        reply,
        deferReply,
        editReply,
        followUp,
        deferred: false,
        replied: false,
    } as any;

    return interaction;
};

describe('handleInteraction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handles slash command when member is APIInteractionGuildMember', async () => {
        const commandExecute = vi.fn().mockResolvedValue(undefined);
        const commandMap = new Map([
            [
                'ping',
                {
                    name: 'ping',
                    description: 'Ping command',
                    module: CommandModule.Core,
                    allowedRoles: [CommandRole.Everyone],
                    execute: commandExecute,
                },
            ],
        ]);

        const services: any = {
            guilds: {
                requireConfig: vi.fn().mockResolvedValue({
                    roles: {},
                    channels: {},
                    setupComplete: { core: true },
                }),
                get: vi.fn().mockResolvedValue({
                    setupComplete: { core: true },
                }),
            },
            repos: { userRepo: null },
        };

        const interaction = createBaseInteraction();
        const reply = interaction.reply;

        await expect(handleInteraction(interaction, commandMap, services)).resolves.toBeUndefined();
        expect(commandExecute).toHaveBeenCalled();
        expect(reply).not.toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining('Unable to determine') }),
        );
    });

    it('defers slash commands before loading guild configuration', async () => {
        const callOrder: string[] = [];
        const commandExecute = vi.fn().mockResolvedValue(undefined);
        const commandMap = new Map([
            [
                'ping',
                {
                    name: 'ping',
                    description: 'Ping command',
                    module: CommandModule.Core,
                    allowedRoles: [CommandRole.Everyone],
                    execute: commandExecute,
                },
            ],
        ]);

        const services: any = {
            guilds: {
                requireConfig: vi.fn(),
                get: vi.fn().mockImplementation(async () => {
                    callOrder.push('guilds.get');
                    return { setupComplete: { core: true } };
                }),
            },
            repos: { userRepo: null },
        };

        const interaction = createBaseInteraction();
        interaction.deferReply.mockImplementation(async () => {
            callOrder.push('deferReply');
            interaction.deferred = true;
        });

        await handleInteraction(interaction, commandMap, services);

        expect(callOrder).toEqual(['deferReply', 'guilds.get']);
        expect(commandExecute).toHaveBeenCalled();
    });

    it('allows command handlers to call deferReply after the central slash command defer', async () => {
        const commandExecute = vi.fn(async ({ interaction }) => {
            await interaction.deferReply({ flags: 1 << 6 });
            await interaction.editReply('pong');
        });
        const commandMap = new Map([
            [
                'ping',
                {
                    name: 'ping',
                    description: 'Ping command',
                    module: CommandModule.Core,
                    allowedRoles: [CommandRole.Everyone],
                    execute: commandExecute,
                },
            ],
        ]);

        const services: any = {
            guilds: {
                requireConfig: vi.fn(),
                get: vi.fn().mockResolvedValue({
                    setupComplete: { core: true },
                }),
            },
            repos: { userRepo: null },
        };

        const interaction = createBaseInteraction();
        const deferReply = interaction.deferReply;

        await handleInteraction(interaction, commandMap, services);

        expect(deferReply).toHaveBeenCalledTimes(1);
        expect(interaction.editReply).toHaveBeenCalledWith('pong');
    });
});
