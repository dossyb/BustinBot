import type { BotStatsService } from './BotStatsService';
import type { TaskService } from '../../modules/tasks/TaskService';
import type { TaskEventStore } from '../../modules/tasks/TaskEventStore';
import type { KeywordSelector } from '../../modules/tasks/KeywordSelector';
import type { ITaskRepository } from '../database/interfaces/ITaskRepo';
import type { IPrizeDrawRepository } from '../database/interfaces/IPrizeDrawRepo';

export interface ServiceContainer {
    botStats: BotStatsService;
    tasks: TaskService;
    taskEvents: TaskEventStore;
    keywords: KeywordSelector;
    repos: {
        taskRepo?: ITaskRepository;
        prizeRepo?: IPrizeDrawRepository;
    };
}