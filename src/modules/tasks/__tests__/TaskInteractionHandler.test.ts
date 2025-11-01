import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleTaskFeedback = vi.fn();
const handleSubmitButton = vi.fn().mockResolvedValue(undefined);
const handleAdminButton = vi.fn().mockResolvedValue(undefined);
const handleTaskSelect = vi.fn().mockResolvedValue(undefined);
const handleRejectionModal = vi.fn().mockResolvedValue(undefined);
const handleUpdateTaskModal = vi.fn().mockResolvedValue(undefined);

vi.mock('../HandleTaskFeedback', () => ({ handleTaskFeedback }));
vi.mock('../TaskInteractions', () => ({
    handleSubmitButton,
    handleAdminButton,
    handleTaskSelect,
    handleRejectionModal,
}));
vi.mock('../HandleUpdateTaskModal', () => ({
    handleUpdateTaskModal,
}));

const persist = vi.fn().mockResolvedValue(undefined);
const getSelections = vi.fn();
const getMissingFields = vi.fn();
const clearSelections = vi.fn();
const setSelection = vi.fn();

vi.mock('../../../core/services/SetupService', () => ({
    setupService: {
        getSelections,
        getMissingFields,
        persist,
        clearSelections,
        setSelection,
    },
}));

const services: any = {
    tasks: { repository: { name: 'taskRepo' } },
    guilds: { name: 'guildService' },
};

const { handleTaskInteraction } = await import('../TaskInteractionHandler');

const baseInteraction = () => ({
    user: { id: 'user-1' },
    guildId: 'guild-1',
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isRoleSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isChatInputCommand: () => false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleTaskInteraction', () => {
    it('routes task feedback button', async () => {
        const interaction: any = {
            ...baseInteraction(),
            isButton: () => true,
            customId: 'task-feedback-up-task-1',
        };

        await handleTaskInteraction(interaction, {} as any, services);
        expect(handleTaskFeedback).toHaveBeenCalledWith(interaction, services.tasks.repository);
    });

    it('persists setup when all selections made', async () => {
        const interaction: any = {
            ...baseInteraction(),
            isButton: () => true,
            customId: 'tasksetup_confirm',
        };

        getSelections.mockReturnValue({ taskAdmin: 'a', taskUser: 'b', taskChannel: 'c', taskVerification: 'd' });
        getMissingFields.mockReturnValue([]);

        await handleTaskInteraction(interaction, {} as any, services);

        expect(persist).toHaveBeenCalledWith('task', services.guilds, 'guild-1', expect.any(Object));
        expect(clearSelections).toHaveBeenCalledWith('task', 'user-1');
        expect(interaction.update).toHaveBeenCalledWith({
            content: expect.stringContaining('setup complete'),
            components: [],
        });
    });

    it('warns when setup selections missing', async () => {
        const interaction: any = {
            ...baseInteraction(),
            isButton: () => true,
            customId: 'tasksetup_confirm',
        };

        getSelections.mockReturnValue({ taskAdmin: 'a' });
        getMissingFields.mockReturnValue(['taskUser']);

        await handleTaskInteraction(interaction, {} as any, services);

        expect(interaction.reply).toHaveBeenCalledWith({
            content: expect.stringContaining('taskUser'),
            flags: 1 << 6,
        });
        expect(persist).not.toHaveBeenCalled();
    });

    it('cancels setup and clears selections', async () => {
        const interaction: any = {
            ...baseInteraction(),
            isButton: () => true,
            customId: 'tasksetup_cancel',
        };

        await handleTaskInteraction(interaction, {} as any, services);

        expect(clearSelections).toHaveBeenCalledWith('task', 'user-1');
        expect(interaction.update).toHaveBeenCalledWith({
            content: expect.stringContaining('cancelled'),
            components: [],
        });
    });

    it('stores role selection values', async () => {
        const interaction: any = {
            ...baseInteraction(),
            isRoleSelectMenu: () => true,
            customId: 'tasksetup_admin_role',
            values: ['role-1'],
            deferUpdate: vi.fn().mockResolvedValue(undefined),
        };

        await handleTaskInteraction(interaction, {} as any, services);

        expect(setSelection).toHaveBeenCalledWith('task', 'user-1', 'taskAdmin', 'role-1');
        expect(interaction.deferUpdate).toHaveBeenCalled();
    });

    it('stores channel selection values', async () => {
        const interaction: any = {
            ...baseInteraction(),
            isChannelSelectMenu: () => true,
            customId: 'tasksetup_channel',
            values: ['channel-1'],
            deferUpdate: vi.fn().mockResolvedValue(undefined),
        };

        await handleTaskInteraction(interaction, {} as any, services);

        expect(setSelection).toHaveBeenCalledWith('task', 'user-1', 'taskChannel', 'channel-1');
        expect(interaction.deferUpdate).toHaveBeenCalled();
    });
});
