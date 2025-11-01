import { BotRepository } from "../database/BotRepo.js";
import { TaskRepository } from "../database/TaskRepo.js";
import { PrizeDrawRepository } from "../database/PrizeDrawRepo.js";
import { KeywordRepository } from "../database/KeywordRepo.js";
import { BotStatsService } from "./BotStatsService.js";
import { TaskService } from "../../modules/tasks/TaskService.js";
import { TaskEventStore } from "../../modules/tasks/TaskEventStore.js";
import { KeywordSelector } from "../../modules/tasks/KeywordSelector.js";
import { MovieRepository } from "../database/MovieRepo.js";
import { GuildRepository } from "../database/GuildRepo.js";
import { GuildService } from "./GuildService.js";
import type { ServiceContainer } from "./ServiceContainer.js";
import { UserRepository } from "../database/UserRepo.js";

export async function createServiceContainer(guildId: string): Promise<ServiceContainer> {
    const botRepo = new BotRepository();
    const guildRepo = new GuildRepository();
    const taskRepo = new TaskRepository(guildId);
    const prizeRepo = new PrizeDrawRepository(guildId);
    const keywordRepo = new KeywordRepository(guildId);
    const movieRepo = new MovieRepository(guildId);
    const userRepo = new UserRepository(guildId);

    const botStats = new BotStatsService(botRepo);
    await botStats.init();

    const guilds = new GuildService(guildRepo);
    const tasks = new TaskService(taskRepo);
    const taskEvents = new TaskEventStore(taskRepo);
    const keywords = new KeywordSelector(keywordRepo);

    const services: ServiceContainer = {
        guildId,
        botStats,
        tasks,
        taskEvents,
        keywords,
        guilds,
        repos: { taskRepo, prizeRepo, movieRepo, keywordRepo, guildRepo, userRepo },
    };

    return services;
}
