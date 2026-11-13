import path from "node:path";
import type { Interaction, Message } from "discord.js";
import type { APIInteraction, GatewayVoiceStateUpdateDispatchData } from "discord-api-types/v10";
import { DateTime } from "luxon";
import { test as base } from "vitest";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { createServiceContainer } from "../src/core/services/ServiceFactory.js";
import { BotStatsService } from "../src/core/services/BotStatsService.js";
import { BotRepository } from "../src/core/database/BotRepo.js";
import { loadCommands } from "../src/core/services/CommandService.js";
import { routeInteraction } from "../src/core/events/routeInteraction.js";
import { handleMessage } from "../src/core/events/onMessage.js";
import { GuildRepository } from "../src/core/database/GuildRepo.js";
import type { ServiceContainer } from "../src/core/services/ServiceContainer.js";
import { Skill, TaskCategory, TaskType, type Task } from "../src/models/Task.js";
import type { TaskEvent } from "../src/models/TaskEvent.js";
import type { Firestore } from "firebase-admin/firestore";
import { DiscordHarness } from "./discord/harness.js";
import { IDS, apiGuild, apiRole, messageCreate, type MessageCreateParams } from "./discord/payloads.js";
import { newEmulatorDatabase, offlineAgent } from "./firestoreEmulator.js";
import {
    guildFactory,
    keywordFactory,
    lifetimeLeaderboardFactory,
    movieEventFactory,
    movieFactory,
    moviePollFactory,
    periodicLeaderboardFactory,
    prizeDrawFactory,
    submissionDraftFactory,
    taskEventFactory,
    taskFactory,
    taskPollFactory,
    taskSubmissionFactory,
    userStatsFactory,
} from "./factories.js";

function saved<T>(save: (value: T) => Promise<unknown>): (value: T) => Promise<T> {
    return async (value) => {
        await save(value);
        return value;
    };
}

function storingFactories(db: Firestore, services: ServiceContainer) {
    const { repos } = services;
    return {
        task: taskFactory.onCreate(saved((task) => repos.taskRepo.createTask(task))),
        taskEvent: taskEventFactory.onCreate(saved((event) => repos.taskRepo.createTaskEvent(event))),
        taskPoll: taskPollFactory.onCreate(saved((poll) => repos.taskRepo.createTaskPoll(poll))),
        taskSubmission: taskSubmissionFactory.onCreate(
            saved((submission) => repos.taskRepo.createSubmission(submission)),
        ),
        submissionDraft: submissionDraftFactory.onCreate(saved((draft) => repos.taskRepo.saveSubmissionDraft(draft))),
        userStats: userStatsFactory.onCreate(saved((stats) => repos.userRepo.createUser(stats))),
        periodicLeaderboard: periodicLeaderboardFactory.onCreate(
            saved((board) => repos.taskLeaderboardRepo.createLeaderboard(board)),
        ),
        lifetimeLeaderboard: lifetimeLeaderboardFactory.onCreate(
            saved((board) => repos.taskLeaderboardRepo.createLeaderboard(board)),
        ),
        prizeDraw: prizeDrawFactory.onCreate(saved((draw) => repos.prizeRepo.createPrizeDraw(draw))),
        movie: movieFactory.onCreate(saved((movie) => repos.movieRepo.upsertMovie(movie))),
        movieEvent: movieEventFactory.onCreate(saved((event) => repos.movieRepo.createMovieEvent(event))),
        moviePoll: moviePollFactory.onCreate(saved((poll) => repos.movieRepo.createPoll(poll))),
        keyword: keywordFactory.onCreate(
            saved((keyword) => db.doc(`guilds/${services.guildId}/keywords/${keyword.id}`).set(keyword)),
        ),
    };
}

export type StoringFactories = ReturnType<typeof storingFactories>;

const TASK_ID_PREFIXES: Record<TaskCategory, string> = {
    [TaskCategory.PvM]: "PVM",
    [TaskCategory.Skilling]: "SKL",
    [TaskCategory.MinigameMisc]: "MIN",
    [TaskCategory.Leagues]: "LEA",
    [TaskCategory.MonisChoice]: "MONIS",
};
const POLL_SKILLS = [Skill.Mining, Skill.Fishing, Skill.Cooking];

export async function storeWeeks(factories: StoringFactories, firstStart: DateTime, ids: string[]): Promise<string[]> {
    for (const [week, id] of ids.entries()) {
        await factories.taskEvent.create({ id, startTime: firstStart.plus({ weeks: week }).toJSDate() });
    }
    return ids;
}

export async function storeRunningEvent(
    factories: StoringFactories,
    event: Parameters<StoringFactories["taskEvent"]["create"]>[0] = {},
): Promise<TaskEvent> {
    const task = await factories.task.create(event.task);
    return factories.taskEvent.running().create({ channelId: IDS.channel, ...event, task });
}

export const WEEKLY_CATEGORIES = [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc];

export async function storeTaskWeek(
    factories: StoringFactories,
    {
        startTime,
        categories = WEEKLY_CATEGORIES,
        completedBy = {},
        monisChoice = {},
    }: {
        startTime: Date;
        categories?: TaskCategory[];
        completedBy?: Partial<Record<TaskCategory, string[]>>;
        monisChoice?: Parameters<StoringFactories["taskEvent"]["create"]>[0] | false;
    },
): Promise<{ regularEvents: TaskEvent[]; monisChoice: TaskEvent | undefined }> {
    const week = DateTime.fromJSDate(startTime, { zone: "utc" });
    const regularEvents: TaskEvent[] = [];
    for (const [index, category] of categories.entries()) {
        const id = `${TASK_ID_PREFIXES[category]}001`;
        regularEvents.push(
            await factories.taskEvent.create({
                id: `${id}-${week.toFormat("yyyyLLdd")}`,
                task: { id, category },
                startTime: week.plus({ seconds: index }).toJSDate(),
                channelId: IDS.channel,
                completedUserIds: completedBy[category] ?? [],
            }),
        );
    }
    if (monisChoice === false) return { regularEvents, monisChoice: undefined };

    const { task, ...overrides } = monisChoice;
    const event = await factories.taskEvent.create({
        id: `MONIS-${week.toFormat("yyyyLLdd")}`,
        task: {
            id: "MONIS",
            taskName: "Bank 100 Monis",
            description: "Screenshot your bank with the keyword visible.",
            category: TaskCategory.MonisChoice,
            type: TaskType.Other,
            ...task,
        },
        startTime,
        endTime: regularEvents.at(-1)?.endTime ?? week.plus({ weeks: 1 }).toJSDate(),
        channelId: IDS.channel,
        ...overrides,
    });
    return { regularEvents, monisChoice: event };
}

export async function storePeriodic(
    factories: StoringFactories,
    board: Parameters<StoringFactories["periodicLeaderboard"]["create"]>[0] = {},
): Promise<void> {
    await factories.periodicLeaderboard.create(board);
    await factories.lifetimeLeaderboard.create();
}

export async function storeFinishedPeriod(
    factories: StoringFactories,
    board: Parameters<StoringFactories["periodicLeaderboard"]["create"]>[0] = {},
): Promise<void> {
    const eventIds = await storeWeeks(factories, DateTime.now().minus({ weeks: 4, days: 1 }), [
        "week-1",
        "week-2",
        "week-3",
        "week-4",
    ]);
    await storePeriodic(factories, { ...board, period: { length: eventIds.length, eventIds, ...board.period } });
}

export function championRoles() {
    return {
        first: apiRole({ name: "Task Champion (1st)" }),
        second: apiRole({ name: "Task Champion (2nd)" }),
        third: apiRole({ name: "Task Champion (3rd)" }),
    };
}

export async function addChampionRoles(
    discord: DiscordHarness,
    services: ServiceContainer,
    { configured = true } = {},
): Promise<ReturnType<typeof championRoles>> {
    const roles = championRoles();
    for (const role of Object.values(roles)) await discord.addRole(IDS.guild, role);
    await services.guilds.update(IDS.guild, {
        roles: {
            taskChampionFirst: configured ? roles.first.id : "",
            taskChampionSecond: configured ? roles.second.id : "",
            taskChampionThird: configured ? roles.third.id : "",
        },
    });
    return roles;
}

export async function storePollableTasks(
    factories: StoringFactories,
    categories: TaskCategory[] = [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc],
): Promise<Task[]> {
    const tasks: Task[] = [];
    for (const category of categories) {
        for (const [index, skill] of POLL_SKILLS.entries()) {
            tasks.push(
                await factories.task.create({
                    id: `${TASK_ID_PREFIXES[category]}00${index + 1}`,
                    category,
                    ...(category === TaskCategory.Skilling ? { skill } : {}),
                }),
            );
        }
    }
    return tasks;
}

export const COMMANDS_DIR = path.join(import.meta.dirname, "../src/modules/commands");

export type Interact = (payload: APIInteraction) => Promise<Interaction>;

export const test = base
    .extend("http", ({}, { onCleanup }) => {
        const offline = getGlobalDispatcher();
        const agent = offlineAgent();
        setGlobalDispatcher(agent);
        onCleanup(async () => {
            setGlobalDispatcher(offline);
            const unused = agent.pendingInterceptors().filter((interceptor) => !interceptor.persist);
            await agent.close();
            if (unused.length) {
                const routes = unused
                    .map(({ method, origin, path }) => `${method} ${origin}${String(path)}`)
                    .join("\n");
                throw new Error(`Expected requests were never made:\n${routes}`);
            }
        });
        return agent;
    })
    .extend("discord", async ({ http }, { onCleanup }) => {
        const discord = new DiscordHarness(http);
        await discord.connect();
        onCleanup(() => discord.client.destroy());
        return discord;
    })
    .extend("openDatabases", { scope: "file" }, ({}, { onCleanup }) => {
        const databases: Firestore[] = [];
        onCleanup(async () => {
            await Promise.all(databases.map((db) => db.terminate()));
        });
        return databases;
    })
    .extend("db", ({ openDatabases }) => {
        const db = newEmulatorDatabase();
        openDatabases.push(db);
        return db;
    })
    .extend("services", async ({ db }) => {
        await new GuildRepository(db).initGuild(IDS.guild, guildFactory.build());
        const botStats = new BotStatsService(new BotRepository(db));
        await botStats.init();
        return createServiceContainer(db, IDS.guild, botStats);
    })
    .extend("factories", ({ db, services }) => storingFactories(db, services))
    .extend("otherGuild", async ({ db, services }) => {
        const channel = IDS.otherGuildChannel;
        const channels = {
            announcements: channel,
            taskChannel: channel,
            taskVerification: channel,
            movieNight: channel,
        };
        await new GuildRepository(db).initGuild(IDS.otherGuild, guildFactory.build({ id: IDS.otherGuild, channels }));
        return createServiceContainer(db, IDS.otherGuild, services.botStats);
    })
    .extend("uncachedGuild", async ({ db, discord }) => {
        await new GuildRepository(db).initGuild(IDS.uncachedGuild, guildFactory.build({ id: IDS.uncachedGuild }));
        discord.serveGuild(apiGuild({ id: IDS.uncachedGuild }));
        return { guild_id: IDS.uncachedGuild };
    })
    .extend("commands", { scope: "file" }, () => loadCommands(COMMANDS_DIR))
    .extend("interact", ({ discord, services, commands }): Interact => async (payload) => {
        const interaction = await discord.sendInteraction(payload);
        await routeInteraction(interaction, commands, services);
        return interaction;
    })
    .extend("voice", ({ discord, services }) => async (state: GatewayVoiceStateUpdateDispatchData): Promise<void> => {
        const [oldState, newState] = await discord.updateVoiceState(state);
        services.movieAttendance.voiceStateChanged(oldState, newState);
    })
    .extend(
        "prefix",
        ({ discord, services, commands }) =>
            async (content: string, overrides: MessageCreateParams = {}): Promise<Message> => {
                const message = await discord.sendMessage(messageCreate(content, overrides));
                await handleMessage(message, commands, services);
                return message;
            },
    );

export { describe, expect, vi, beforeEach, afterEach } from "vitest";
