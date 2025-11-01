import { describe, expect, it, vi } from 'vitest';

const botRepoInstance = { name: 'botRepo' };
const taskRepoInstance = { name: 'taskRepo' };
const prizeRepoInstance = { name: 'prizeRepo' };
const keywordRepoInstance = { name: 'keywordRepo' };
const movieRepoInstance = { name: 'movieRepo' };
const guildRepoInstance = { name: 'guildRepo' };
const userRepoInstance = { name: 'userRepo' };

const BotRepository = vi.fn(() => botRepoInstance);
const TaskRepository = vi.fn(() => taskRepoInstance);
const PrizeDrawRepository = vi.fn(() => prizeRepoInstance);
const KeywordRepository = vi.fn(() => keywordRepoInstance);
const MovieRepository = vi.fn(() => movieRepoInstance);
const GuildRepository = vi.fn(() => guildRepoInstance);
const UserRepository = vi.fn(() => userRepoInstance);

vi.mock('../../database/BotRepo', () => ({ BotRepository }));
vi.mock('../../database/TaskRepo', () => ({ TaskRepository }));
vi.mock('../../database/PrizeDrawRepo', () => ({ PrizeDrawRepository }));
vi.mock('../../database/KeywordRepo', () => ({ KeywordRepository }));
vi.mock('../../database/MovieRepo', () => ({ MovieRepository }));
vi.mock('../../database/GuildRepo', () => ({ GuildRepository }));
vi.mock('core/database/UserRepo', () => ({ UserRepository }));

const botStatsInit = vi.fn().mockResolvedValue(undefined);
const BotStatsService = vi.fn(() => ({ init: botStatsInit }));
vi.mock('../BotStatsService', () => ({ BotStatsService }));

const TaskService = vi.fn((repo: unknown) => ({ kind: 'TaskService', repo }));
vi.mock('../../../modules/tasks/TaskService', () => ({ TaskService }));

const TaskEventStore = vi.fn((repo: unknown) => ({ kind: 'TaskEventStore', repo }));
vi.mock('../../../modules/tasks/TaskEventStore', () => ({ TaskEventStore }));

const KeywordSelector = vi.fn((repo: unknown) => ({ kind: 'KeywordSelector', repo }));
vi.mock('../../../modules/tasks/KeywordSelector', () => ({ KeywordSelector }));

const GuildService = vi.fn((repo: unknown) => ({ kind: 'GuildService', repo }));
vi.mock('../GuildService', () => ({ GuildService }));

describe('createServiceContainer', () => {
    it('constructs repositories and services with initialised bot stats', async () => {
        const { createServiceContainer } = await import('../ServiceFactory');

        const services = await createServiceContainer('guild-42');

        expect(BotRepository).toHaveBeenCalledTimes(1);
        expect(GuildRepository).toHaveBeenCalledTimes(1);
        expect(TaskRepository).toHaveBeenCalledWith('guild-42');
        expect(PrizeDrawRepository).toHaveBeenCalledWith('guild-42');
        expect(keywordRepoInstance).toBeDefined();

        expect(BotStatsService).toHaveBeenCalledWith(botRepoInstance);
        expect(botStatsInit).toHaveBeenCalled();

        expect(TaskService).toHaveBeenCalledWith(taskRepoInstance);
        expect(TaskEventStore).toHaveBeenCalledWith(taskRepoInstance);
        expect(KeywordSelector).toHaveBeenCalledWith(keywordRepoInstance);
        expect(GuildService).toHaveBeenCalledWith(guildRepoInstance);

        expect(services).toEqual(expect.objectContaining({
            guildId: 'guild-42',
            tasks: expect.objectContaining({ kind: 'TaskService', repo: taskRepoInstance }),
            taskEvents: expect.objectContaining({ kind: 'TaskEventStore', repo: taskRepoInstance }),
            keywords: expect.objectContaining({ kind: 'KeywordSelector', repo: keywordRepoInstance }),
            guilds: expect.objectContaining({ kind: 'GuildService', repo: guildRepoInstance }),
            repos: expect.objectContaining({
                taskRepo: taskRepoInstance,
                prizeRepo: prizeRepoInstance,
                movieRepo: movieRepoInstance,
                keywordRepo: keywordRepoInstance,
                guildRepo: guildRepoInstance,
                userRepo: userRepoInstance,
            }),
        }));
    });
});
