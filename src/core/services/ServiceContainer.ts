import type { BotStatsService } from "./BotStatsService.js";
import type { TaskService } from "../../modules/tasks/TaskService.js";
import type { TaskEventStore } from "../../modules/tasks/TaskEventStore.js";
import type { KeywordSelector } from "../../modules/tasks/KeywordSelector.js";
import type { MovieAttendance } from "../../modules/movies/MovieAttendance.js";
import type { ManualPollSelections } from "../../modules/movies/MovieManualPoll.js";
import type { ITaskRepository } from "../database/interfaces/ITaskRepo.js";
import type { IPrizeDrawRepository } from "../database/interfaces/IPrizeDrawRepo.js";
import type { IMovieRepository } from "../database/interfaces/IMovieRepo.js";
import type { GuildService } from "./GuildService.js";
import type { SetupService } from "./SetupService.js";
import type { IGuildRepository } from "../database/interfaces/IGuildRepo.js";
import type { IKeywordRepository } from "../database/interfaces/IKeywordRepo.js";
import type { IUserRepository } from "../database/interfaces/IUserRepo.js";
import type { ITaskLeaderboardRepository } from "../database/interfaces/ITaskLeaderboardRepo.js";

export interface ServiceContainer {
    guildId: string;
    botStats: BotStatsService;
    tasks: TaskService;
    taskEvents: TaskEventStore;
    keywords: KeywordSelector;
    guilds: GuildService;
    setup: SetupService;
    movieAttendance: MovieAttendance;
    manualPolls: ManualPollSelections;
    repos: {
        guildRepo: IGuildRepository;
        taskRepo: ITaskRepository;
        prizeRepo: IPrizeDrawRepository;
        movieRepo: IMovieRepository;
        keywordRepo: IKeywordRepository;
        userRepo: IUserRepository;
        taskLeaderboardRepo: ITaskLeaderboardRepository;
    };
}
