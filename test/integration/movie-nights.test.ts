import type { MovieEvent } from "../../src/models/MovieEvent.js";
import assert from "node:assert";
import { SnowflakeUtil, TimestampStyles, time } from "discord.js";
import { DateTime } from "luxon";
import { type APIRole, InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, vi, type StoringFactories, test } from "../fixtures.js";
import { type DiscordHarness } from "../discord/harness.js";
import { type ServiceContainer } from "../../src/core/services/ServiceContainer.js";
import { createServiceContainer } from "../../src/core/services/ServiceFactory.js";
import {
    AS,
    DiscordError,
    IDS,
    NAMES,
    apiMessage,
    apiRole,
    apiUser,
    apiVoiceChannel,
    apiVoiceState,
    modalSubmitInteraction,
    stringSelectInteraction,
    chatInputInteraction,
    apiOtherGuild,
} from "../discord/payloads.js";
import { movieFactory, moviePollFactory, movieEventFactory } from "../factories.js";
import { sweepMovieNight } from "../../src/modules/movies/MovieScheduler.js";
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from "../firestoreEmulator.js";

const VOICE = SnowflakeUtil.generate().toString();
const SUBMITTER = SnowflakeUtil.generate().toString();
const [present, joiner, leaver] = [
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
    SnowflakeUtil.generate().toString(),
];

async function setUpMovieNight(discord: DiscordHarness, services: ServiceContainer): Promise<APIRole> {
    const movieUsers = apiRole({ name: "Movie Night" });
    await discord.addChannel(apiVoiceChannel({ id: VOICE }));
    await discord.addRole(IDS.guild, movieUsers);
    await services.guilds.update(IDS.guild, {
        channels: { movieNight: IDS.channel, movieVC: VOICE },
        roles: { movieUser: movieUsers.id },
    });
    return movieUsers;
}

async function storeNight(
    factories: StoringFactories,
    overrides: Parameters<StoringFactories["movieEvent"]["create"]>[0] = {},
    nights: StoringFactories["movieEvent"] = factories.movieEvent,
): Promise<MovieEvent> {
    return nights.create({
        movie: { id: "movie-2", title: "Arrival", addedBy: SUBMITTER, runtime: 30 },
        voiceChannelId: VOICE,
        ...overrides,
    });
}

const ANNOUNCEMENT = SnowflakeUtil.generate().toString();

async function storePickedNight(
    factories: StoringFactories,
    nights: StoringFactories["movieEvent"],
    overrides: Parameters<typeof storeNight>[1] = {},
) {
    const movie = await factories.movie.create({
        id: "movie-2",
        title: "Arrival",
        addedBy: SUBMITTER,
        selectedAt: new Date(),
    });
    await storeNight(factories, { movie, ...overrides }, nights);
}

describe("scheduling a movie night", () => {
    test("/movienight offers the next 14 days, by the guild's calendar", async ({ discord, interact, services }) => {
        await services.guilds.update(IDS.guild, { timezone: "Pacific/Kiritimati" });
        // Noon UTC on 5 March, when it is already 6 March in Kiribati
        vi.setSystemTime(new Date("2026-03-05T12:00:00Z"));

        const command = await interact(chatInputInteraction("movienight", [], AS.movieAdmin));

        expect(discord.reply(command)?.content).toBe("📆 Choose a date for the next movie night:");
        expect(discord.reply(command)?.components).toMatchObject([
            {
                components: [
                    {
                        custom_id: "movienight-select-date",
                        options: [
                            { label: "Fri, 6 Mar", value: "2026-03-06" },
                            { label: "Sat, 7 Mar", value: "2026-03-07" },
                            { label: "Sun, 8 Mar", value: "2026-03-08" },
                            { label: "Mon, 9 Mar", value: "2026-03-09" },
                            { label: "Tue, 10 Mar", value: "2026-03-10" },
                            { label: "Wed, 11 Mar", value: "2026-03-11" },
                            { label: "Thu, 12 Mar", value: "2026-03-12" },
                            { label: "Fri, 13 Mar", value: "2026-03-13" },
                            { label: "Sat, 14 Mar", value: "2026-03-14" },
                            { label: "Sun, 15 Mar", value: "2026-03-15" },
                            { label: "Mon, 16 Mar", value: "2026-03-16" },
                            { label: "Tue, 17 Mar", value: "2026-03-17" },
                            { label: "Wed, 18 Mar", value: "2026-03-18" },
                            { label: "Thu, 19 Mar", value: "2026-03-19" },
                        ],
                    },
                ],
            },
        ]);
    });

    test("asks for a start time in the guild's timezone once a date is picked", async ({ discord, interact }) => {
        const pick = await interact(stringSelectInteraction("movienight-select-date", ["2026-03-05"]));

        const form = discord.modal(pick);
        expect(form).toMatchObject({ custom_id: "movienight-time-2026-03-05", title: "Enter movie night time" });
        expect(form?.components).toMatchObject([
            { label: "Start time (UTC+0)", component: { custom_id: "start-time" } },
        ]);
    });

    test("announces it, stores it in place of the previous night, and ends the open poll an hour before", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const now = DateTime.fromISO("2026-03-05T12:00:00Z", { zone: "utc" });
        vi.setSystemTime(now.toJSDate());
        const movieUsers = await setUpMovieNight(discord, services);
        const date = "2026-03-07";
        const start = DateTime.fromISO(`${date}T20:30:00.000Z`);
        const movies = services.repos.movieRepo;
        await factories.movie.create({
            id: "old-pick",
            title: "Old Pick",
            selectedAt: now.minus({ hours: 2 }).toJSDate(),
        });
        await factories.movie.create({
            id: "latest-pick",
            title: "Latest Pick",
            selectedAt: now.minus({ hours: 1 }).toJSDate(),
        });
        await factories.movie.create({ id: "watched", title: "Watched", watched: true, selectedAt: now.toJSDate() });
        await storeNight(factories, { id: "previous" });
        await factories.moviePoll.create({ endsAt: start.plus({ hours: 1 }).toJSDate() });
        discord.acceptMessages(IDS.channel);

        const submit = await interact(modalSubmitInteraction(`movienight-time-${date}`, { "start-time": "20:30" }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content: expect.stringMatching(/^Movie night scheduled for \*\*.+\*\* at \*\*20:30\*\*\.$/),
            }),
        ]);
        const [announcement] = discord.messagesSentTo(IDS.channel);
        expect(announcement).toMatchObject({
            content: `<@&${movieUsers.id}>`,
            embeds: [expect.objectContaining({ title: "Now showing: Latest Pick" })],
        });
        expect(announcement?.embeds?.[0]?.fields).toContainEqual(
            expect.objectContaining({
                name: "🎥 Start Time",
                value: expect.stringContaining("Reminders will be sent at"),
            }),
        );
        const events = await movies.getAllEvents();
        expect(events.find((event) => event.id === "previous")).toMatchObject({ completed: true });
        const night = await movies.getActiveEvent();
        assert(night);
        expect(night).toMatchObject({
            startTime: start.toJSDate(),
            voiceChannelId: VOICE,
            channelId: IDS.channel,
            announcementMessageId: expect.any(String),
            movie: { id: "latest-pick" },
        });
        expect((await movies.getActivePoll())?.endsAt).toEqual(start.minus({ hours: 1 }).toJSDate());
    });

    test("points members at the running poll and stores a placeholder movie when none is chosen yet", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const now = DateTime.fromISO("2026-03-05T12:00:00Z", { zone: "utc" });
        vi.setSystemTime(now.toJSDate());
        await setUpMovieNight(discord, services);
        const date = "2026-03-07";
        const pollChannel = SnowflakeUtil.generate().toString();
        await factories.moviePoll.open().create({ channelId: pollChannel });
        discord.acceptMessages(IDS.channel);

        await interact(modalSubmitInteraction(`movienight-time-${date}`, { "start-time": "21:00" }));

        expect(discord.messagesSentTo(IDS.channel)[0]?.embeds?.[0]?.description).toContain(
            `A poll is currently running in <#${pollChannel}>`,
        );
        expect(await services.repos.movieRepo.getActiveEvent()).toMatchObject({
            movie: { id: "TBD", title: "TBD" },
        });
    });

    test("rejects a time that isn't HH:MM, scheduling nothing", async ({ discord, interact, services }) => {
        const submit = await interact(modalSubmitInteraction("movienight-time-2026-03-05", { "start-time": "8pm" }));

        expect(discord.callbacks(submit)).toEqual([
            expect.objectContaining({ type: InteractionResponseType.DeferredChannelMessageWithSource }),
        ]);
        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Invalid time format. Use 24-hour HH:MM format (e.g. 20:30)." }),
        ]);
        expect(await services.repos.movieRepo.getActiveEvent()).toBeNull();
    });
});

describe("the movie night sweep", () => {
    test("sends each reminder once when it comes due", async ({ discord, services, factories }) => {
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ hours: 3 }).toJSDate());
        const movieUsers = await setUpMovieNight(discord, services);
        await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        for (const sweepAt of [
            start.minus({ hours: 2 }),
            start.minus({ hours: 2 }).plus({ minutes: 1 }),
            start.minus({ minutes: 30 }),
            start,
            start.plus({ minutes: 1 }),
        ]) {
            vi.setSystemTime(sweepAt.toJSDate());
            await sweepMovieNight(discord.client, services);
        }

        const startsAt = time(start.toJSDate(), TimestampStyles.ShortTime);
        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            `<@&${movieUsers.id}> Movie night starts in **2 hours** (at ${startsAt})! We will be watching **Arrival**!`,
            `<@&${movieUsers.id}> Movie night starts in **30 minutes** (at ${startsAt})! We will be watching **Arrival**!`,
            `<@&${movieUsers.id}> Movie night is starting **now**! Join us in <#${VOICE}> 🎬\nWe will be watching **Arrival**!`,
        ]);
    });

    test("starts the reminder with no mention when no movie role is set", async ({ discord, services, factories }) => {
        await setUpMovieNight(discord, services);
        await services.guilds.update(IDS.guild, { roles: { movieUser: "" } });
        const night = await storeNight(factories, { startTime: DateTime.now().plus({ minutes: 30 }).toJSDate() });
        discord.acceptMessages(IDS.channel);

        await sweepMovieNight(discord.client, services);

        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            `Movie night starts in **30 minutes** (at ${time(night.startTime, TimestampStyles.ShortTime)})! We will be watching **Arrival**!`,
        ]);
    });

    test("sends only the latest reminder that came due while the bot was down, and none once it is too late", async ({
        discord,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ hours: 1 }).toJSDate());
        const movieUsers = await setUpMovieNight(discord, services);
        const night = await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        vi.setSystemTime(start.minus({ minutes: 20 }).toJSDate());
        await sweepMovieNight(discord.client, services);
        vi.setSystemTime(start.plus({ minutes: 20 }).toJSDate());
        await sweepMovieNight(discord.client, services);

        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            `<@&${movieUsers.id}> Movie night starts in **20 minutes** (at ${time(start.toJSDate(), TimestampStyles.ShortTime)})! We will be watching **Arrival**!`,
        ]);
        expect(warn).toHaveBeenCalledWith(
            `[MovieReminders] Skipped the "start time" reminder for ${night.id}: it came due while the bot was down.`,
        );
    });

    test("holds a reminder while the movie night channel can't be reached, and sends it once it can", async ({
        discord,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ minutes: 30 }).toJSDate());
        await setUpMovieNight(discord, services);
        await services.guilds.update(IDS.guild, { channels: { movieNight: "" } });
        await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        await sweepMovieNight(discord.client, services);
        await services.guilds.update(IDS.guild, { channels: { movieNight: IDS.channel } });
        vi.setSystemTime(start.minus({ minutes: 29 }).toJSDate());
        await sweepMovieNight(discord.client, services);

        expect(warn).toHaveBeenCalledWith(
            `[Channels] The movieNight channel (not set) of guild ${IDS.guild} isn't set or can't be reached.`,
        );
        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            expect.stringContaining("Movie night starts in **29 minutes**"),
        ]);
    });

    test("keeps working from what is stored after a restart", async ({ discord, services, db, factories }) => {
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ minutes: 30 }).toJSDate());
        await setUpMovieNight(discord, services);
        await storeNight(factories, { startTime: start.toJSDate(), remindersSent: ["2 hours before"] });
        discord.acceptMessages(IDS.channel);
        const restarted = createServiceContainer(db, IDS.guild, services.botStats);

        await sweepMovieNight(discord.client, restarted);

        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            expect.stringContaining("Movie night starts in **30 minutes**"),
        ]);
    });

    test("closes the poll once its time is up, picks the winner and announces it once", async ({
        discord,
        services,
        factories,
    }) => {
        const now = DateTime.fromISO("2026-03-05T12:00:00Z", { zone: "utc" });
        vi.setSystemTime(now.toJSDate());
        await setUpMovieNight(discord, services);
        const poll = await factories.moviePoll.ended().create({
            options: [
                movieFactory.build({ id: "movie-1", addedBy: SUBMITTER }),
                movieFactory.build({ id: "movie-2", title: "Arrival", addedBy: SUBMITTER }),
            ],
            votes: { [present]: "movie-2", [joiner]: "movie-2", [leaver]: "movie-1" },
        });
        await storeNight(factories, {
            startTime: now.plus({ hours: 3 }).toJSDate(),
            movie: { id: "TBD", title: "TBD" },
        });
        discord.serveMessage(apiMessage({ id: poll.messageId }));
        discord.acceptMessageEdits(IDS.channel);
        discord.acceptMessages(IDS.channel);
        const dm = discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));

        await sweepMovieNight(discord.client, services);
        await sweepMovieNight(discord.client, services);

        expect(await services.repos.movieRepo.getActivePoll()).toBeNull();
        expect(await services.repos.movieRepo.getMovieById("movie-2")).toMatchObject({
            selectedBy: "Scheduler",
            selectedAt: expect.any(Date),
        });
        expect(await services.repos.movieRepo.getActiveEvent()).toMatchObject({ movie: { id: "movie-2" } });
        const announcements = discord
            .messagesSentTo(IDS.channel)
            .filter((message) => message.embeds?.[0]?.title === "🏆 Movie poll closed!");
        expect(announcements).toHaveLength(1);
        expect(announcements[0]?.embeds?.[0]?.description).toContain("**Arrival**");
        expect(discord.messageEdits(IDS.channel, poll.messageId)[0]?.content).toContain("**Arrival** was selected!");
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({ content: expect.stringContaining("Your movie **Arrival** has been chosen") }),
        ]);
    });

    test("counts attendance from when the movie is picked and ends the night once its movie has run", async ({
        discord,
        services,
        voice,
        factories,
    }) => {
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ minutes: 10 }).toJSDate());
        await setUpMovieNight(discord, services);
        const night = await storeNight(factories, {
            startTime: start.toJSDate(),
            remindersSent: ["2 hours before", "30 mins before", "start time"],
        });
        await factories.movie.create(night.movie);
        for (const userId of [present, leaver]) await voice(apiVoiceState(userId, VOICE));
        discord.acceptMessages(IDS.channel);
        const dm = discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));
        await factories.userStats.create({ userId: present });

        vi.setSystemTime(start.minus({ minutes: 5 }).toJSDate());
        await sweepMovieNight(discord.client, services);
        expect(services.movieAttendance.isTracking(night.id)).toBe(true);

        vi.setSystemTime(start.toJSDate());
        await sweepMovieNight(discord.client, services);
        vi.setSystemTime(start.plus({ minutes: 10 }).toJSDate());
        await voice(apiVoiceState(leaver, null));
        await voice(apiVoiceState(joiner, VOICE));
        vi.setSystemTime(start.plus({ minutes: 60 }).toJSDate());
        await sweepMovieNight(discord.client, services);
        vi.setSystemTime(start.plus({ minutes: 61 }).toJSDate());
        await sweepMovieNight(discord.client, services);

        expect(await services.repos.userRepo.getUserById(present)).toMatchObject({ moviesAttended: 1 });
        expect(await services.repos.userRepo.getUserById(joiner)).toMatchObject({ moviesAttended: 1 });
        expect(await services.repos.userRepo.getUserById(leaver)).toBeNull();
        expect(await services.repos.movieRepo.getActiveEvent()).toBeNull();
        expect(await services.repos.movieRepo.getMovieById("movie-2")).toMatchObject({
            watched: true,
            watchedAt: start.plus({ minutes: 60 }).toJSDate(),
        });
        expect(
            discord.messagesSentTo(IDS.channel).filter((message) => message.content?.includes("has finished")),
        ).toEqual([
            expect.objectContaining({
                content:
                    "🎞️ **Arrival** has finished and has now been archived from the active list. Thanks for watching!",
            }),
        ]);
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({ content: expect.stringContaining("your movie **Arrival** has been watched") }),
        ]);
    });

    test("sends nothing more for a night that was cancelled", async ({ discord, interact, services, factories }) => {
        const start = DateTime.fromISO("2026-03-05T20:00:00Z", { zone: "utc" });
        vi.setSystemTime(start.minus({ hours: 1 }).toJSDate());
        await setUpMovieNight(discord, services);
        await storeNight(factories, { startTime: start.toJSDate() });
        discord.acceptMessages(IDS.channel);

        await interact(chatInputInteraction("cancelmovie", [], AS.movieAdmin));
        vi.setSystemTime(start.minus({ minutes: 30 }).toJSDate());
        await sweepMovieNight(discord.client, services);
        vi.setSystemTime(start.toJSDate());
        await sweepMovieNight(discord.client, services);

        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            `❌ Movie night has been cancelled by <@${IDS.user}>.`,
        ]);
    });

    test("keeps each guild's movie night to itself", async ({ discord, services, otherGuild, factories }) => {
        const now = DateTime.fromISO("2026-03-05T12:00:00Z", { zone: "utc" });
        vi.setSystemTime(now.toJSDate());
        await discord.addGuild(apiOtherGuild());
        const duePoll = moviePollFactory.ended().build({
            votes: { [present]: "movie-2" },
            messageId: "",
            channelId: IDS.otherGuildChannel,
        });
        await otherGuild.repos.movieRepo.createPoll(duePoll);
        await factories.moviePoll.open().create();
        discord.acceptMessages(IDS.otherGuildChannel);
        discord.acceptDirectMessages(apiUser());

        for (const guild of [services, otherGuild]) await sweepMovieNight(discord.client, guild);

        expect(discord.messagesSentTo(IDS.otherGuildChannel)).toEqual([
            expect.objectContaining({ embeds: [expect.objectContaining({ title: "🏆 Movie poll closed!" })] }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
        expect(await services.repos.movieRepo.getActivePoll()).not.toBeNull();
    });
});

describe("/endmovie", () => {
    test("ends tonight's movie night, archives the movie and thanks everyone in the movie night channel", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storePickedNight(
            factories,
            factories.movieEvent.params({ startTime: DateTime.now().minus({ hours: 1 }).toJSDate() }),
        );
        discord.acceptMessages(IDS.channel);
        discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));

        const command = await interact(chatInputInteraction("endmovie", [], AS.movieAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "The movie night for **Arrival** has ended and been archived." }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: "🎞️ Movie night has ended. Thanks for watching **Arrival**!" }),
        ]);
        expect(await services.repos.movieRepo.getMovieById("movie-2")).toMatchObject({ watched: true });
    });

    test("tells the member whose movie was watched how many more they can add", async ({
        discord,
        interact,
        factories,
    }) => {
        await storePickedNight(
            factories,
            factories.movieEvent.params({ startTime: DateTime.now().minus({ hours: 1 }).toJSDate() }),
        );
        await factories.movie.create({ id: "still-listed", addedBy: SUBMITTER });
        await factories.movie.create({ id: "watched-before", addedBy: SUBMITTER, watched: true });
        discord.acceptMessages(IDS.channel);
        const dm = discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));

        await interact(chatInputInteraction("endmovie", [], AS.movieAdmin));

        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({
                content: `Hey <@${SUBMITTER}>, your movie **Arrival** has been watched as part of a movie night in **${NAMES.guild}**. You can now add **2 more movies** to the list!`,
            }),
        ]);
    });

    test("says so when no movie night is on", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("endmovie", [], AS.movieAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No active movie event found to end." }),
        ]);
    });

    test("ends a night whose movie was never picked, keeping its placeholder", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const night = await storeNight(factories, { movie: { id: "TBD", title: "TBD" } });
        discord.acceptMessages(IDS.channel);

        const command = await interact(chatInputInteraction("endmovie", [], AS.movieAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: "The movie night has ended, but no selected movie was found to archive.",
            }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
        expect(await services.repos.movieRepo.getLatestEvent()).toEqual({
            ...night,
            completed: true,
            completedAt: expect.any(Date),
        });
        expect(warn).toHaveBeenCalledWith(
            `[MovieLifecycle] Movie night ended by ${NAMES.username}, but no selected movie record could be resolved for event ${night.id}.`,
        );
    });
});

describe("/closemoviepoll", () => {
    test("closes the poll and announces the winner in the movie night channel", async ({
        discord,
        interact,
        factories,
    }) => {
        const poll = await factories.moviePoll.create({
            options: [
                movieFactory.build({ id: "movie-1", addedBy: SUBMITTER }),
                movieFactory.build({ id: "movie-2", title: "Arrival", addedBy: SUBMITTER }),
            ],
            votes: {
                [SnowflakeUtil.generate().toString()]: "movie-2",
                [SnowflakeUtil.generate().toString()]: "movie-2",
            },
        });
        discord.serveMessage(apiMessage({ id: poll.messageId }));
        discord.acceptMessageEdits(IDS.channel);
        discord.acceptMessages(IDS.channel);
        discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));

        const command = await interact(chatInputInteraction("closemoviepoll", [], AS.movieAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: "✅ Movie poll closed successfully.\nPoll closed successfully. Arrival won with 2 votes.",
            }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ embeds: [expect.objectContaining({ title: "🏆 Movie poll closed!" })] }),
        ]);
    });

    test("says so when no poll is open", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("closemoviepoll", [], AS.movieAdmin));

        expect(discord.originalEdits(command)).toEqual([expect.objectContaining({ content: "No active poll found." })]);
    });
});

describe("/cancelmovie", () => {
    test("closes the poll, ends the night, unpicks its movie and marks both posts cancelled", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const poll = await factories.moviePoll.open().create();
        await storePickedNight(factories, factories.movieEvent.upcoming(), { announcementMessageId: ANNOUNCEMENT });
        for (const id of [poll.messageId, ANNOUNCEMENT]) discord.serveMessage(apiMessage({ id }));
        discord.acceptMessageEdits(IDS.channel);

        const command = await interact(chatInputInteraction("cancelmovie", [], AS.movieAdmin));

        expect(discord.originalEdits(command)[0]?.content).toBe(
            "Movie night cancelled successfully.\n\nActions taken:\n" +
                [
                    "- Active movie poll set inactive",
                    "- Poll message updated to show cancellation",
                    "- Movie night event marked as cancelled",
                    "- Movie night announcement updated to show cancellation",
                    '- Unpicked movie "Arrival"',
                ].join("\n"),
        );
        expect(discord.messageEdits(IDS.channel, poll.messageId)).toEqual([
            expect.objectContaining({ content: `❌ This movie poll was cancelled by <@${IDS.user}>.`, components: [] }),
        ]);
        expect(discord.messageEdits(IDS.channel, ANNOUNCEMENT)).toEqual([
            expect.objectContaining({ content: `❌ Movie night has been cancelled by <@${IDS.user}>.` }),
        ]);
        expect(await services.repos.movieRepo.getActivePoll()).toBeNull();
        expect(await services.repos.movieRepo.getActiveEvent()).toBeNull();
        expect((await services.repos.movieRepo.getMovieById("movie-2"))?.selectedAt).toBeUndefined();
    });

    test("posts the cancellation in the movie night channel when its announcement is gone", async ({
        discord,
        interact,
        factories,
    }) => {
        await storePickedNight(factories, factories.movieEvent.upcoming(), { announcementMessageId: ANNOUNCEMENT });
        discord.refuse("GET", `/channels/${IDS.channel}/messages/${ANNOUNCEMENT}`, DiscordError.unknownMessage);
        discord.acceptMessages(IDS.channel);

        await interact(chatInputInteraction("cancelmovie", [], AS.movieAdmin));

        expect(
            discord.requests.filter((request) => request.path === `/channels/${IDS.channel}/messages/${ANNOUNCEMENT}`),
        ).toHaveLength(1);

        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({ content: `❌ Movie night has been cancelled by <@${IDS.user}>.` }),
        ]);
    });
});

describe("/currentmovie", () => {
    test("shows the scheduled night's movie, start time and host", async ({ discord, interact, factories }) => {
        const host = apiUser({ id: SnowflakeUtil.generate().toString(), username: "host" });
        discord.serveUser(host);
        const night = await factories.movieEvent.create({
            movie: { title: "Arrival", overview: "Linguists meet visitors." },
            hostedBy: host.id,
        });
        const start = night.startTime;

        const command = await interact(chatInputInteraction("currentmovie"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "Now showing: Arrival",
                        description: `Linguists meet visitors.\n\n_Added by <@${IDS.user}>_`,
                        fields: expect.arrayContaining([
                            {
                                name: "🎥 Start Time",
                                value: `${time(start, TimestampStyles.LongDateTime)} (${time(start, TimestampStyles.RelativeTime)})\n\n🎬 We will be watching **Arrival**!`,
                                inline: false,
                            },
                        ]),
                        footer: { text: "Scheduled by host • Powered by TMDb" },
                    }),
                ],
            }),
        ]);
    });

    test("says no movie is picked yet when the night was scheduled before one was", async ({
        discord,
        interact,
        factories,
    }) => {
        const host = apiUser({ id: SnowflakeUtil.generate().toString(), username: "host" });
        discord.serveUser(host);
        const night = await factories.movieEvent.create({
            movie: { id: "TBD", title: "TBD" },
            hostedBy: host.id,
        });
        const start = night.startTime;

        const command = await interact(chatInputInteraction("currentmovie"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "🎞️ Upcoming Movie Night!",
                        description: `${time(start, TimestampStyles.LongDateTime)} (${time(start, TimestampStyles.RelativeTime)})\n\n📭 No movie has been selected yet.`,
                        footer: { text: "Scheduled by host" },
                    }),
                ],
            }),
        ]);
    });

    test("says so when no night is scheduled", async ({ discord, interact, factories }) => {
        await factories.movieEvent.create({ completed: true });

        const command = await interact(chatInputInteraction("currentmovie"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No movie night is currently scheduled." }),
        ]);
    });
});

describe("MovieRepository events", () => {
    test("returns the active event with the latest start time, as dates", async ({ services }) => {
        await services.repos.movieRepo.createMovieEvent(
            movieEventFactory.build({ id: "early", startTime: new Date("2026-01-03T09:00:00.000Z") }),
        );
        await services.repos.movieRepo.createMovieEvent(
            movieEventFactory.build({ id: "late", startTime: new Date("2026-01-10T09:00:00.000Z") }),
        );
        await services.repos.movieRepo.createMovieEvent(movieEventFactory.build({ id: "done", completed: true }));

        const active = await services.repos.movieRepo.getActiveEvent();
        expect(active?.id).toBe("late");
        expect(active?.startTime).toEqual(new Date("2026-01-10T09:00:00.000Z"));
    });

    test("completes an event once, with the changes given", async ({ services }) => {
        const event = movieEventFactory.build();
        await services.repos.movieRepo.createMovieEvent(event);
        const completedAt = new Date("2026-01-03T12:00:00.000Z");

        const movie = movieFactory.build({ watched: true });

        expect(await services.repos.movieRepo.completeEvent(event.id, completedAt, movie)).toBe(true);
        expect(await services.repos.movieRepo.getLatestEvent()).toEqual({
            ...event,
            completed: true,
            completedAt,
            movie,
        });
        expect(await services.repos.movieRepo.completeEvent(event.id, new Date())).toBe(false);
        expect(await services.repos.movieRepo.completeEvent("missing", new Date())).toBe(false);
        expect(await services.repos.movieRepo.getActiveEvent()).toBeNull();
    });

    test(
        "completes an event completed twice at the same moment once",
        async ({ services }) => {
            const event = movieEventFactory.build();
            await services.repos.movieRepo.createMovieEvent(event);

            const completed = await Promise.all([
                services.repos.movieRepo.completeEvent(event.id, new Date()),
                services.repos.movieRepo.completeEvent(event.id, new Date()),
            ]);

            expect(completed.filter(Boolean)).toHaveLength(1);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );

    test("claims each reminder once, and none for an event that has ended", async ({ services }) => {
        const event = movieEventFactory.build();
        await services.repos.movieRepo.createMovieEvent(event);
        await services.repos.movieRepo.createMovieEvent(movieEventFactory.build({ id: "ended", completed: true }));

        expect(await services.repos.movieRepo.claimReminders(event.id, ["2 hours before"])).toEqual(["2 hours before"]);
        expect(await services.repos.movieRepo.claimReminders(event.id, ["2 hours before", "30 mins before"])).toEqual([
            "30 mins before",
        ]);
        expect(await services.repos.movieRepo.claimReminders("ended", ["start time"])).toEqual([]);
        expect((await services.repos.movieRepo.getActiveEvent())?.remindersSent).toEqual([
            "2 hours before",
            "30 mins before",
        ]);
    });

    test(
        "claims a reminder claimed twice at the same moment once",
        async ({ services }) => {
            const event = movieEventFactory.build();
            await services.repos.movieRepo.createMovieEvent(event);

            const claims = await Promise.all([
                services.repos.movieRepo.claimReminders(event.id, ["start time"]),
                services.repos.movieRepo.claimReminders(event.id, ["start time"]),
            ]);

            expect(claims.flat()).toEqual(["start time"]);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );
});
