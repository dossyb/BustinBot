import type { ServiceContainer } from '../services/ServiceContainer';
import type { BotStatsService } from '../services/BotStatsService';
import type { Command } from '../../models/Command';

describe('Bot startup smoke test', () => {
    afterEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('initialises service container, registers commands, and schedules tasks without throwing', async () => {
        // ---- Mocks for external modules invoked by index.ts ----
        vi.doMock('dotenv', () => ({ config: vi.fn(() => ({ parsed: {} })) }));
        vi.doMock('../database/firestore', () => ({ db: {} }));

        const mockClient = {
            on: vi.fn(),
            once: vi.fn(),
            login: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };

        vi.doMock('discord.js', () => {
            const putMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
            const restInstance: any = {
                put: putMock,
                setToken: vi.fn(() => restInstance),
            };
            return {
                Client: vi.fn(() => mockClient),
                REST: vi.fn(() => restInstance),
                Routes: { applicationGuildCommands: vi.fn() },
                GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4, DirectMessages: 8 },
                Partials: { Channel: 1 },
                SlashCommandBuilder: vi.fn(),
            };
        });

        vi.doMock('../../modules/movies/MoviePollScheduler', () => ({
            scheduleActivePollClosure: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        }));
        vi.doMock('../events/onMessage', () => ({ handleMessage: vi.fn() }));
        vi.doMock('../events/onInteraction', () => ({ handleInteraction: vi.fn() }));
        vi.doMock('../../modules/tasks/TaskInteractions', () => ({
            handleDirectMessage: vi.fn(),
            handleTaskInteraction: vi.fn(),
        }));

        // ---- Mock BotStatsService (class) ----
        const mockBotStats = {
            init: vi.fn(async () => { }),
            incrementBustin: vi.fn(async () => { }),
            incrementGoodBot: vi.fn(async () => { }),
            incrementBadBot: vi.fn(async () => { }),
            getStats: vi.fn(() => null),
            getGoodBotCount: vi.fn(() => 0),
            getBadBotCount: vi.fn(() => 0),
        } as unknown as BotStatsService;

        const mockServices = {
            repos: { taskRepo: {} as any, prizeRepo: {} as any, movieRepo: {} as any },
            tasks: {} as any,
            taskEvents: {} as any,
            keywords: {} as any,
            botStats: mockBotStats,
        } as unknown as ServiceContainer;

        vi.doMock('../services/ServiceFactory', () => ({
            createServiceContainer: vi.fn(async () => mockServices),
        }));

        vi.doMock('../services/CommandService', () => ({
            loadCommands: vi.fn(async () => new Map<string, Command>()),
        }));

        // ---- Env setup ----
        process.env.DISCORD_TOKEN_DEV = 'token';
        process.env.DISCORD_CLIENT_ID = 'client';
        process.env.DISCORD_GUILD_ID = 'guild';

        // ---- Run main index (startup) ----
        await expect(import('../../index')).resolves.not.toThrow();
    });
});
