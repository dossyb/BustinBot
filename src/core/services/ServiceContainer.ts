import type { BotStatsService } from './BotStatsService.js';
import type { TaskService } from '../../modules/tasks/TaskService.js';
import type { TaskEventStore } from '../../modules/tasks/TaskEventStore.js';
import type { KeywordSelector } from '../../modules/tasks/KeywordSelector.js';
import type { ITaskRepository } from '../database/interfaces/ITaskRepo.js';
import type { IPrizeDrawRepository } from '../database/interfaces/IPrizeDrawRepo.js';
import type { IMovieRepository } from '../database/interfaces/IMovieRepo.js';
import type { GuildService } from './GuildService.js';
import type { IGuildRepository } from '../database/interfaces/IGuildRepo.js';
import type { IKeywordRepository } from '../database/interfaces/IKeywordRepo.js';
import type { IUserRepository } from '../database/interfaces/IUserRepo.js';

export interface ServiceContainer {
    guildId: string;
    botStats: BotStatsService;
    tasks: TaskService;
    taskEvents: TaskEventStore;
    keywords: KeywordSelector;
    guilds: GuildService;
    repos: {
        guildRepo?: IGuildRepository;
        taskRepo?: ITaskRepository;
        prizeRepo?: IPrizeDrawRepository;
        movieRepo?: IMovieRepository;
        keywordRepo?: IKeywordRepository;
        userRepo?: IUserRepository;
    };
}
