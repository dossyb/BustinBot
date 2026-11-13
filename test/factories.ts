import { SlashCommandBuilder, SnowflakeUtil } from "discord.js";
import { Factory } from "fishery";
import { DateTime } from "luxon";
import { TaskCategory, TaskType, type Task } from "../src/models/Task.js";
import type { TaskEvent } from "../src/models/TaskEvent.js";
import type { UserStats } from "../src/models/UserStats.js";
import { SubmissionStatus, type TaskSubmission, type TaskSubmissionDraft } from "../src/models/TaskSubmission.js";
import type { TaskPoll } from "../src/models/TaskPoll.js";
import type { Guild, TaskMilestoneRole } from "../src/models/Guild.js";
import type { Movie } from "../src/models/Movie.js";
import type { MovieEvent } from "../src/models/MovieEvent.js";
import type { MoviePoll } from "../src/models/MoviePoll.js";
import type { TaskLeaderboard, TaskLeaderboardPeriod } from "../src/models/TaskLeaderboard.js";
import type { PrizeDraw } from "../src/models/PrizeDraw.js";
import type { BotStats } from "../src/models/BotStats.js";
import type { Keyword } from "../src/models/Keyword.js";
import type { TaskFeedback } from "../src/models/TaskFeedback.js";
import { CommandModule, CommandRole, type Command } from "../src/models/Command.js";
import { IDS } from "./discord/payloads.js";

export const taskFactory = Factory.define<Task>(() => ({
    id: "PVM001",
    taskName: "Kill {amount} Zulrah",
    category: TaskCategory.PvM,
    type: TaskType.KC,
    amtBronze: 10,
    amtSilver: 25,
    amtGold: 50,
    weight: 50,
}));

class TaskEventFactory extends Factory<TaskEvent> {
    running() {
        return this.params({ startTime: DateTime.now().minus({ days: 1 }).toJSDate() });
    }

    ended() {
        return this.params({ endTime: DateTime.now().minus({ days: 1 }).toJSDate() });
    }
}

export const taskEventFactory = TaskEventFactory.define(({ params }) => {
    const task = taskFactory.build(params.task);
    const startTime =
        params.startTime ??
        (params.endTime
            ? DateTime.fromJSDate(params.endTime, { zone: "utc" }).minus({ weeks: 1 }).toJSDate()
            : new Date("2026-01-05T00:00:00.000Z"));
    const endTime = params.endTime ?? DateTime.fromJSDate(startTime, { zone: "utc" }).plus({ weeks: 1 }).toJSDate();
    return {
        id: `${task.id}-20260105`,
        task,
        category: task.category,
        amounts: { bronze: task.amtBronze, silver: task.amtSilver, gold: task.amtGold },
        keyword: "keyword",
        startTime,
        endTime,
        completionCounts: { bronze: 0, silver: 0, gold: 0 },
        completedUserIds: [],
        createdAt: startTime,
    };
});

export const userStatsFactory = Factory.define<UserStats>(() => ({
    userId: IDS.user,
    joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastActiveAt: new Date("2026-01-01T00:00:00.000Z"),
    commandsRun: 0,
    moviesAdded: 0,
    moviesWatched: 0,
    moviesAttended: 0,
    moviePollsVoted: 0,
    tasksCompletedBronze: 0,
    tasksCompletedSilver: 0,
    tasksCompletedGold: 0,
    taskStreak: 0,
    longestTaskStreak: 0,
    taskPollsVoted: 0,
    taskPrizesWon: 0,
    taskChampionFirsts: 0,
    taskChampionSeconds: 0,
    taskChampionThirds: 0,
    legacyTasksCompleted: 0,
    totalXP: 0,
    leaderboardRank: 0,
}));

export const taskSubmissionFactory = Factory.define<TaskSubmission>(() => ({
    id: "submission-1",
    userId: IDS.user,
    taskEventId: "PVM001-20260105",
    taskName: "Kill 10 Zulrah",
    screenshotUrls: ["https://cdn.discordapp.com/attachments/1/2/proof.png"],
    status: SubmissionStatus.Pending,
    createdAt: new Date("2026-01-06T00:00:00.000Z"),
}));

export const submissionDraftFactory = Factory.define<TaskSubmissionDraft>(() => ({
    userId: IDS.user,
    taskEventId: "PVM001-20260105",
    createdAt: new Date("2026-01-06T00:00:00.000Z"),
}));

class TaskPollFactory extends Factory<TaskPoll> {
    open() {
        return this.params({
            createdAt: DateTime.now().minus({ hours: 1 }).toJSDate(),
            endsAt: DateTime.now().plus({ hours: 1 }).toJSDate(),
        });
    }

    ended() {
        return this.params({ endsAt: DateTime.now().minus({ seconds: 1 }).toJSDate() });
    }
}

export const taskPollFactory = TaskPollFactory.define(({ params }): TaskPoll => {
    const messageId = params.messageId ?? SnowflakeUtil.generate().toString();
    return {
        id: messageId,
        type: "task",
        category: TaskCategory.PvM,
        options: [
            taskFactory.build({ id: "PVM001" }),
            taskFactory.build({ id: "PVM002" }),
            taskFactory.build({ id: "PVM003" }),
        ],
        messageId,
        channelId: IDS.channel,
        createdAt: new Date("2026-01-04T00:00:00.000Z"),
        endsAt: new Date("2026-01-05T00:00:00.000Z"),
        isActive: true,
        votes: {},
    };
});

export const taskFeedbackFactory = Factory.define<Omit<TaskFeedback, "id">>(() => ({
    taskId: "PVM001",
    eventId: "PVM001-20260105",
    userId: IDS.user,
    vote: "up",
}));

export const guildFactory = Factory.define<Guild>(() => ({
    id: IDS.guild,
    toggles: { taskScheduler: false, leaguesEnabled: false },
    roles: { ...IDS.roles },
    channels: {
        announcements: IDS.channel,
        taskChannel: IDS.channel,
        taskVerification: IDS.channel,
        movieNight: IDS.channel,
    },
    setupComplete: { core: true, movie: true, task: true },
    timezone: "UTC",
}));

export const milestoneRoleFactory = Factory.define<TaskMilestoneRole>(({ params }) => {
    const roleId = params.roleId ?? SnowflakeUtil.generate().toString();
    return { id: roleId, label: "Task Participant", roleId, requiredSubmissions: 5, enabled: true };
});

export const keywordFactory = Factory.define<Keyword>(() => ({
    id: "keyword",
    word: "keyword",
    lastUsedAt: new Date(0),
    timesUsed: 0,
    usageHistory: [],
}));

export const movieFactory = Factory.define<Movie>(() => ({
    id: "movie-1",
    title: "Inception",
    watched: false,
    addedBy: IDS.user,
    addedAt: new Date("2026-01-01T00:00:00.000Z"),
    runtime: 148,
}));

class MovieEventFactory extends Factory<MovieEvent> {
    upcoming() {
        return this.params({ startTime: DateTime.now().plus({ days: 1 }).toJSDate() });
    }
}

export const movieEventFactory = MovieEventFactory.define(({ params }): MovieEvent => ({
    id: "event-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    startTime: new Date("2026-01-03T20:00:00.000Z"),
    movie: movieFactory.build(params.movie),
    channelId: IDS.channel,
    completed: false,
    hostedBy: IDS.user,
}));

class MoviePollFactory extends Factory<MoviePoll> {
    open() {
        return this.params({
            createdAt: DateTime.now().minus({ hours: 1 }).toJSDate(),
            endsAt: DateTime.now().plus({ hours: 1 }).toJSDate(),
        });
    }

    ended() {
        return this.params({ endsAt: DateTime.now().minus({ seconds: 1 }).toJSDate() });
    }
}

export const moviePollFactory = MoviePollFactory.define((): MoviePoll => ({
    id: "poll-1",
    type: "movie",
    options: [movieFactory.build({ id: "movie-1" }), movieFactory.build({ id: "movie-2", title: "Arrival" })],
    messageId: SnowflakeUtil.generate().toString(),
    channelId: IDS.channel,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    endsAt: new Date("2026-01-02T00:00:00.000Z"),
    isActive: true,
    votes: {},
}));

export const leaderboardPeriodFactory = Factory.define<TaskLeaderboardPeriod>(() => ({
    length: 4,
    eventIds: [],
    startedAt: "2026-01-05T00:00:00.000Z",
    index: 1,
}));

export const periodicLeaderboardFactory = Factory.define<TaskLeaderboard>(({ params }) => ({
    id: "periodic",
    points: {},
    tierCounts: {},
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
    period: leaderboardPeriodFactory.build(params.period),
}));

export const lifetimeLeaderboardFactory = Factory.define<TaskLeaderboard>(() => ({
    id: "lifetime",
    points: {},
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-05T00:00:00.000Z",
}));

export const prizeDrawFactory = Factory.define<PrizeDraw>(() => ({
    id: "2026-01-05_to_2026-01-18",
    start: "2026-01-05T00:00:00.000Z",
    end: "2026-01-18T23:59:59.999Z",
    snapshotTakenAt: "2026-01-19T00:00:00.000Z",
    participants: {},
    entries: [],
    totalEntries: 0,
}));

export const botStatsFactory = Factory.define<BotStats>(() => ({
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    commandsRun: 0,
    commandsByName: {},
    messagesSeen: 0,
    guildCount: 0,
    channelCount: 0,
    userCount: 0,
    moviesAdded: 0,
    moviesWatched: 0,
    moviePollsRun: 0,
    tasksAdded: 0,
    taskPollsRun: 0,
    tasksCompleted: 0,
    funStats: { bustinCount: 0, goodbotCount: 0, badbotCount: 0 },
    errorCount: 0,
    lastUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
}));

export const commandFactory = Factory.define<Command>(({ params }) => {
    const name = params.name ?? "probe";
    return {
        name,
        description: name,
        module: CommandModule.Core,
        allowedRoles: [CommandRole.Everyone],
        slashData: new SlashCommandBuilder().setName(name).setDescription(name),
        execute: async () => {},
    };
});
