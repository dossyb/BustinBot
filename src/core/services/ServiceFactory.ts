import { BotRepository } from "../database/BotRepo";
import { TaskRepository } from "../database/TaskRepo";
import { PrizeDrawRepository } from "../database/PrizeDrawRepo";
import { KeywordRepository } from "../database/KeywordRepo";
import { BotStatsService } from "./BotStatsService";
import { TaskService } from "../../modules/tasks/TaskService";
import { TaskEventStore } from "../../modules/tasks/TaskEventStore";
import { KeywordSelector } from "../../modules/tasks/KeywordSelector";
import { MovieRepository } from "../database/MovieRepo";
import { GuildRepository } from "../database/GuildRepo";
import { GuildService } from "./GuildService";
import type { ServiceContainer } from "./ServiceContainer";

export async function createServiceContainer(guildId: string): Promise<ServiceContainer> {
    const botRepo = new BotRepository();
    const guildRepo = new GuildRepository();
    const taskRepo = new TaskRepository(guildId);
    const prizeRepo = new PrizeDrawRepository(guildId);
    const keywordRepo = new KeywordRepository(guildId);
    const movieRepo = new MovieRepository(guildId);

    const botStats = new BotStatsService(botRepo);
    await botStats.init();

    const guilds = new GuildService(guildRepo);
    const tasks = new TaskService(taskRepo);
    const taskEvents = new TaskEventStore(taskRepo);
    const keywords = new KeywordSelector(keywordRepo);

    const services: ServiceContainer = {
        botStats, tasks, taskEvents, keywords, guilds, repos: { taskRepo, prizeRepo, movieRepo },
    };

    return services;
}