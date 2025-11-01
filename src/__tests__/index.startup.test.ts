import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfig = vi.fn();
vi.mock('dotenv', () => ({ config: mockConfig }));

const mockSlashToJSON = vi.fn(() => ({ name: 'slash-cmd' }));
const mockCommands = new Map<string, any>();
const loadCommands = vi.fn(async () => mockCommands);
vi.mock('../core/services/CommandService', () => ({ loadCommands }));

const registerGuildCommands = vi.fn().mockResolvedValue(undefined);
vi.mock('../utils/registerCommands', () => ({ registerGuildCommands }));

const scheduleActivePollClosure = vi.fn().mockResolvedValue(undefined);
vi.mock('../modules/movies/MoviePollScheduler', () => ({ scheduleActivePollClosure }));

const initTaskScheduler = vi.fn();
vi.mock('../modules/tasks/TaskScheduler', () => ({ initTaskScheduler }));

const initMovieScheduler = vi.fn();
vi.mock('../modules/movies/MovieScheduler', () => ({ initMovieScheduler }));

const handleMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('../core/events/onMessage', () => ({ handleMessage }));

const handleInteraction = vi.fn().mockResolvedValue(undefined);
vi.mock('../core/events/onInteraction', () => ({ handleInteraction }));

const handleDirectMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('../modules/tasks/TaskInteractions', () => ({ handleDirectMessage }));

const handleTaskInteraction = vi.fn().mockResolvedValue(undefined);
vi.mock('../modules/tasks/TaskInteractionHandler', () => ({ handleTaskInteraction }));

const handleMovieInteraction = vi.fn().mockResolvedValue(undefined);
vi.mock('../modules/movies/MovieInteractionHandler', () => ({ handleMovieInteraction }));

const guildConfigs = [
    { id: 'guild-1', toggles: { taskScheduler: true } },
    { id: 'guild-2', toggles: { taskScheduler: false } },
];
const getAllGuilds = vi.fn(async () => guildConfigs);
vi.mock('../core/database/GuildRepo', () => ({
    GuildRepository: vi.fn().mockImplementation(() => ({ getAllGuilds })),
}));

const createServiceContainer = vi.fn(async (guildId: string) => ({ guildId, repos: {} }));
vi.mock('../core/services/ServiceFactory', () => ({ createServiceContainer }));

const Routes = {
    applicationGuildCommands: vi.fn((clientId: string, guildId: string) => `route:${clientId}:${guildId}`),
};
const restPut = vi.fn().mockResolvedValue(undefined);
class MockREST {
    static latest: MockREST | null = null;
    constructor() {
        MockREST.latest = this;
    }
    public token: string | null = null;
    setToken(token: string) {
        this.token = token;
        return this;
    }
    put = restPut;
}

const messageHandlers = new Map<string, (...args: any[]) => unknown>();
const onceHandlers = new Map<string, (...args: any[]) => unknown>();
class MockClient {
    static latest: MockClient | null = null;
    public login = vi.fn().mockResolvedValue(undefined);
    public user = { tag: 'MockBot#0001' };
    constructor() {
        MockClient.latest = this;
    }
    on(event: string, handler: (...args: any[]) => unknown) {
        messageHandlers.set(event, handler);
        return this;
    }
    once(event: string, handler: (...args: any[]) => unknown) {
        onceHandlers.set(event, handler);
        return this;
    }
}

const GatewayIntentBits = { Guilds: 1, GuildMessages: 2, MessageContent: 3, DirectMessages: 4 };
const Partials = { Channel: 'channel' };

vi.mock('discord.js', () => ({
    REST: MockREST,
    Routes,
    Client: MockClient,
    GatewayIntentBits,
    Partials,
}));

const originalEnv = { ...process.env };

describe('index startup script', () => {
    beforeEach(() => {
        process.env.BOT_MODE = 'dev';
        process.env.DISCORD_TOKEN_DEV = 'dev-token';
        process.env.DISCORD_CLIENT_ID = 'client-id';
        process.env.DISCORD_CLIENT_ID_DEV = 'client-id';
        process.env.DISCORD_GUILD_ID = 'env-guild';

        mockConfig.mockClear();
        loadCommands.mockClear();
        mockCommands.clear();
        mockCommands.set('primary', {
            name: 'primary',
            description: 'Primary Command',
            slashData: { toJSON: mockSlashToJSON },
        });
        mockCommands.set('alias-primary', {
            name: 'primary',
            alias: true,
            slashData: { toJSON: mockSlashToJSON },
        });

        restPut.mockClear();
        Routes.applicationGuildCommands.mockClear();
        createServiceContainer.mockClear();
        handleMessage.mockClear();
        handleDirectMessage.mockClear();
        handleInteraction.mockClear();
        handleTaskInteraction.mockClear();
        handleMovieInteraction.mockClear();
        scheduleActivePollClosure.mockClear();
        initTaskScheduler.mockClear();
        initMovieScheduler.mockClear();
        getAllGuilds.mockClear();
        messageHandlers.clear();
        onceHandlers.clear();

    });

    afterEach(() => {
        Object.assign(process.env, originalEnv);
    });

    it('registers slash commands and wires handlers on startup', async () => {
        await import('../index');

        // Allow any pending microtasks to flush
        await Promise.resolve();

        expect(loadCommands).toHaveBeenCalled();
        expect((loadCommands.mock.calls as any)[0]?.[0]).toMatch(/modules[\\/]+commands$/);
        expect(getAllGuilds).toHaveBeenCalled();

        expect(registerGuildCommands).toHaveBeenCalledWith(
            expect.objectContaining({
                guildId: 'guild-1',
                modulesDir: expect.stringMatching(/modules[\/]+commands$/),
                clientId: 'client-id',
                token: 'dev-token',
            })
        );

        const client = MockClient.latest;
        expect(client).toBeTruthy();
        expect(client?.login).toHaveBeenCalledWith('dev-token');

        // Message handler for DMs should use direct message flow
        const messageHandler = messageHandlers.get('messageCreate');
        expect(messageHandler).toBeTypeOf('function');

        const dmMessage = { channel: { type: 1 }, guildId: undefined };
        await messageHandler?.(dmMessage);
        expect(handleDirectMessage).toHaveBeenCalledWith(dmMessage, client, expect.objectContaining({ guildId: 'guild-1' }));

        // Guild message uses handleMessage
        const guildMessage = { channel: { type: 0 }, guildId: 'guild-2' };
        await messageHandler?.(guildMessage);
        expect(handleMessage).toHaveBeenCalledWith(guildMessage, mockCommands, expect.objectContaining({ guildId: 'guild-2' }));

        // Interaction handler dispatches to modules
        const interactionHandler = messageHandlers.get('interactionCreate');
        expect(interactionHandler).toBeTypeOf('function');
        const interaction = { guildId: 'guild-2' };
        await interactionHandler?.(interaction);
        expect(handleInteraction).toHaveBeenCalledWith(interaction, mockCommands, expect.objectContaining({ guildId: 'guild-2' }));
        expect(handleMovieInteraction).toHaveBeenCalled();
        expect(handleTaskInteraction).toHaveBeenCalledWith(interaction, client, expect.any(Object));

        // Simulate ready event
        const readyHandler = onceHandlers.get('clientReady');
        expect(readyHandler).toBeTypeOf('function');
        await readyHandler?.();

        expect(scheduleActivePollClosure).toHaveBeenCalledWith(expect.objectContaining({ guildId: 'guild-1' }), client);
        expect(initTaskScheduler).toHaveBeenCalledTimes(1);
        expect(initTaskScheduler).toHaveBeenCalledWith(client, expect.objectContaining({ guildId: 'guild-1' }));
        expect(initMovieScheduler).toHaveBeenCalledWith(client);
    });
});
