import { SnowflakeUtil } from "discord.js";
import {
    ApplicationCommandOptionType,
    InteractionResponseType,
    MessageFlags,
    PermissionFlagsBits,
    type APIEmbed,
} from "discord-api-types/v10";
import { describe, expect, type StoringFactories, test } from "../fixtures.js";
import {
    AS,
    IDS,
    apiMessage,
    apiUser,
    buttonInteraction,
    modalSubmitInteraction,
    stringSelectInteraction,
    chatInputInteraction,
} from "../discord/payloads.js";
import { moviePollFactory } from "../factories.js";
import { type Movie } from "../../src/models/Movie.js";
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from "../firestoreEmulator.js";

const SUBMITTER = SnowflakeUtil.generate().toString();
const VOICE = SnowflakeUtil.generate().toString();
const pickMessage = apiMessage({ flags: MessageFlags.Ephemeral });

async function storeMovies(factories: StoringFactories, movies: Partial<Movie>[]): Promise<Movie[]> {
    const stored: Movie[] = [];
    for (const [index, movie] of movies.entries()) {
        stored.push(
            await factories.movie.create({
                id: `movie-${index + 1}`,
                addedBy: SUBMITTER,
                addedAt: new Date(Date.UTC(2026, 0, index + 1)),
                ...movie,
            }),
        );
    }
    return stored;
}

describe("a movie poll", () => {
    test("is posted with a button per movie, leaving out one watched since it was chosen, and stored", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeMovies(factories, [{ title: "Inception" }, { title: "Arrival" }, { title: "Heat", watched: true }]);
        discord.acceptMessages(IDS.channel);
        await interact(
            stringSelectInteraction(
                "movie_poll_manual_select",
                ["movie-1", "movie-2", "movie-3"],
                pickMessage,
                AS.movieAdmin,
            ),
        );

        const click = await interact(buttonInteraction("movie_poll_manual_confirm", pickMessage, AS.movieAdmin));

        expect(discord.originalEdits(click)).toEqual([
            expect.objectContaining({ content: "Poll confirmed and posted!" }),
        ]);
        const posted = discord
            .messagesSentTo(IDS.channel)
            .find((message) => message.content?.startsWith("📊 **Vote for the next movie night pick!**"));
        expect(posted?.components).toMatchObject([
            { components: [{ custom_id: "movie_vote_0" }, { custom_id: "movie_vote_1" }] },
        ]);
        expect(posted?.embeds?.map((embed) => embed.title)).toEqual(["Inception", "Arrival"]);
        const poll = await services.repos.movieRepo.getActivePoll();
        expect(poll).toMatchObject({ isActive: true, channelId: IDS.channel, messageId: expect.any(String) });
        expect(poll?.options.map((movie) => movie.id)).toEqual(["movie-1", "movie-2"]);
    });

    test("needs at least two unwatched movies", async ({ discord, interact, services, factories }) => {
        await storeMovies(factories, [{ title: "Inception" }, { title: "Heat", watched: true }]);
        await interact(
            stringSelectInteraction("movie_poll_manual_select", ["movie-1", "movie-2"], pickMessage, AS.movieAdmin),
        );

        const click = await interact(buttonInteraction("movie_poll_manual_confirm", pickMessage, AS.movieAdmin));

        expect(discord.callbacks(click)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "You must select between 2 and 5 movies.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect(await services.repos.movieRepo.getActivePoll()).toBeNull();
    });

    test("counts a member's vote once, lets them change it, and shows the counts", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const poll = await factories.moviePoll.create();
        const pollMessage = apiMessage({
            id: poll.messageId,
            embeds: [
                { title: "Inception", footer: { text: "🗳️ 0 votes" } },
                { title: "Arrival", footer: { text: "🗳️ 0 votes" } },
            ],
        });
        discord.acceptMessageEdits(IDS.channel);

        const first = await interact(buttonInteraction("movie_vote_1", pollMessage));
        const changed = await interact(buttonInteraction("movie_vote_0", pollMessage));

        for (const click of [first, changed]) {
            expect(discord.originalEdits(click)).toEqual([
                expect.objectContaining({ content: "Thank you for your vote!" }),
            ]);
        }
        expect((await services.repos.movieRepo.getActivePoll())?.votes).toEqual({ [IDS.user]: "movie-1" });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ moviePollsVoted: 1 });
        const footers = (embeds: APIEmbed[] | undefined) => embeds?.map((embed) => embed.footer?.text);
        expect(footers(discord.messageEdits(IDS.channel, poll.messageId).at(-1)?.embeds)).toEqual([
            "🗳️ 1 vote | ⏱️ 148 mins | Option 1",
            "🗳️ 0 votes | ⏱️ 148 mins | Option 2",
        ]);
    });
});

describe("choosing the movie for movie night", () => {
    test("takes a list number or a close title, makes it the night's movie, posts it and tells who added it", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeMovies(factories, [{ title: "Inception" }, { title: "Arrival" }]);
        await factories.movieEvent.upcoming().create({ movie: { id: "TBD", title: "TBD" } });
        await services.guilds.update(IDS.guild, { channels: { movieVC: VOICE } });
        discord.acceptMessages(IDS.channel);
        const dm = discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));

        const byNumber = await interact(modalSubmitInteraction("movie_pick_choose_modal", { movie_input: "2" }));
        const byTitle = await interact(modalSubmitInteraction("movie_pick_choose_modal", { movie_input: "incepshun" }));

        expect(discord.originalEdits(byNumber)).toEqual([
            expect.objectContaining({ content: "**Arrival** has been selected and posted!" }),
        ]);
        expect(discord.originalEdits(byTitle)).toEqual([
            expect.objectContaining({ content: "**Inception** has been selected and posted!" }),
        ]);
        expect(discord.messagesSentTo(IDS.channel).map((message) => message.content)).toEqual([
            "The following movie has been selected for movie night:",
            "The following movie has been selected for movie night:",
        ]);
        expect(await services.repos.movieRepo.getActiveEvent()).toMatchObject({
            movie: { id: "movie-1", selectedBy: IDS.user },
            voiceChannelId: VOICE,
        });
        expect(discord.messagesSentTo(dm)).toHaveLength(2);
    });

    test("says so when nothing matches", async ({ discord, interact, factories }) => {
        await storeMovies(factories, [{ title: "Inception" }]);

        const submit = await interact(modalSubmitInteraction("movie_pick_choose_modal", { movie_input: "Paddington" }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "No matching movie found." }),
        ]);
    });

    test("locks in a random pick, but never a movie already watched", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeMovies(factories, [{ title: "Inception", watched: true }, { title: "Arrival" }]);
        discord.acceptMessages(IDS.channel);
        discord.acceptDirectMessages(apiUser({ id: SUBMITTER }));
        const randomPick = apiMessage({ embeds: [{ title: "🎲 Arrival" }] });

        const reroll = await interact(buttonInteraction("reroll_random_movie", randomPick));
        const lockWatched = await interact(buttonInteraction("confirm_random_movie_movie-1", randomPick));
        const lock = await interact(buttonInteraction("confirm_random_movie_movie-2", randomPick));

        expect(discord.callbacks(reroll)).toEqual([
            expect.objectContaining({
                data: expect.objectContaining({ embeds: [expect.objectContaining({ title: "🎲 Arrival" })] }),
            }),
        ]);
        expect(discord.originalEdits(lockWatched)).toEqual([
            expect.objectContaining({ content: "Could not find the selected movie in the active movie list." }),
        ]);
        expect(discord.originalEdits(lock)).toEqual([
            expect.objectContaining({ content: "Movie selected and posted!" }),
        ]);
        expect(await services.repos.movieRepo.getMovieById("movie-2")).toMatchObject({
            selectedBy: IDS.user,
            selectedAt: expect.any(Date),
        });
        expect((await services.repos.movieRepo.getMovieById("movie-1"))?.selectedAt).toBeUndefined();
    });
});

describe("/pickmovie", () => {
    test("offers its four ways to pick, each answered by the bot whenever it is pressed", async ({
        discord,
        interact,
        factories,
    }) => {
        await storeMovies(factories, [{ title: "Inception" }]);
        const command = await interact(chatInputInteraction("pickmovie", [], AS.movieAdmin));
        const [offered] = discord.originalEdits(command);

        const choose = await interact(buttonInteraction("movie_pick_choose", pickMessage, AS.movieAdmin));
        const random = await interact(buttonInteraction("movie_pick_random", pickMessage, AS.movieAdmin));
        const pollRandom = await interact(buttonInteraction("movie_poll_random", pickMessage, AS.movieAdmin));

        expect(offered?.components).toMatchObject([
            {
                components: [
                    { custom_id: "movie_pick_choose" },
                    { custom_id: "movie_pick_random" },
                    { custom_id: "movie_poll_random" },
                    { custom_id: "movie_poll_manual" },
                ],
            },
        ]);
        expect(discord.modal(choose)?.custom_id).toBe("movie_pick_choose_modal");
        expect(discord.originalEdits(random)).toEqual([
            expect.objectContaining({
                content: "A random movie has been selected:",
                embeds: [expect.objectContaining({ title: "🎲 Inception" })],
            }),
        ]);
        expect(discord.reply(pollRandom)?.components).toMatchObject([
            {
                components: [
                    {
                        custom_id: "movie_poll_random_count",
                        options: [{ value: "2" }, { value: "3" }, { value: "4" }, { value: "5" }],
                    },
                ],
            },
        ]);
    });

    test("builds a poll from the movies picked in the manual menu", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeMovies(factories, [{ title: "Inception" }, { title: "Arrival" }, { title: "Heat", watched: true }]);
        discord.acceptMessages(IDS.channel);

        const open = await interact(buttonInteraction("movie_poll_manual", pickMessage, AS.movieAdmin));
        const choose = await interact(
            stringSelectInteraction("movie_poll_manual_select", ["movie-1", "movie-2"], pickMessage, AS.movieAdmin),
        );
        const confirm = await interact(buttonInteraction("movie_poll_manual_confirm", pickMessage, AS.movieAdmin));

        expect(discord.originalEdits(open)[0]?.components).toMatchObject([
            { components: [{ options: [{ label: "1. Inception" }, { label: "2. Arrival" }] }] },
            { components: [{}, {}, { custom_id: "movie_poll_manual_confirm", disabled: true }, {}] },
        ]);
        expect(discord.originalEdits(choose)[0]?.components).toMatchObject([
            {},
            { components: [{}, {}, { custom_id: "movie_poll_manual_confirm", disabled: false }, {}] },
        ]);
        expect(discord.originalEdits(confirm)).toEqual([
            expect.objectContaining({ content: "Poll confirmed and posted!" }),
        ]);
        expect((await services.repos.movieRepo.getActivePoll())?.options.map((movie) => movie.id)).toEqual([
            "movie-1",
            "movie-2",
        ]);
    });

    test("answers a menu choice when every movie has been watched", async ({ discord, interact, factories }) => {
        await storeMovies(factories, [{ title: "Inception", watched: true }]);

        const choose = await interact(
            stringSelectInteraction(
                "movie_poll_manual_select",
                ["movie-1"],
                apiMessage({ flags: MessageFlags.Ephemeral }),
                AS.movieAdmin,
            ),
        );

        expect(discord.callbacks(choose)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        expect(discord.followUps(choose)).toEqual([expect.objectContaining({ content: "No active movies found." })]);
    });
});

describe("/listmovies", () => {
    test("pages through the unwatched movies with buttons that keep working", async ({
        discord,
        interact,
        factories,
    }) => {
        await storeMovies(factories, [
            { title: "Inception" },
            { title: "Arrival" },
            { title: "Heat" },
            { title: "Alien" },
            { title: "Jaws", watched: true },
        ]);

        const command = await interact(chatInputInteraction("listmovies"));
        const [firstPage] = discord.originalEdits(command);
        const next = await interact(
            buttonInteraction("listmovies|next|1", apiMessage({ flags: MessageFlags.Ephemeral })),
        );

        expect(firstPage?.embeds?.map((embed) => embed.title)).toEqual(["1. Inception", "2. Arrival", "3. Heat"]);
        expect(firstPage?.components).toMatchObject([
            {
                components: [
                    { custom_id: "listmovies|start|0" },
                    { custom_id: "listmovies|prev|-1" },
                    { custom_id: "listmovies|next|1" },
                    { custom_id: "listmovies|end|1" },
                ],
            },
        ]);
        expect(discord.callbacks(next)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        const [secondPage] = discord.originalEdits(next);
        expect(secondPage?.embeds?.map((embed) => embed.title)).toEqual(["4. Alien"]);
        expect(secondPage?.components).toMatchObject([
            {
                components: [
                    {},
                    { custom_id: "listmovies|prev|0", disabled: false },
                    {},
                    { custom_id: "listmovies|end|1", disabled: true },
                ],
            },
        ]);
    });

    test("says the queue is empty when every movie has been watched", async ({ discord, interact, factories }) => {
        await factories.movie.create({ watched: true });

        const command = await interact(chatInputInteraction("listmovies"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: "No unwatched movies are currently queued. Add a new one with `/addmovie`!",
            }),
        ]);
    });
});

describe("the movie list", () => {
    test("lets members remove their own movies and admins remove anyone's", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeMovies(factories, [{ title: "Inception" }, { title: "Arrival" }]);
        const someoneElse = { member: { user: { id: SnowflakeUtil.generate().toString() } } };
        const admin = {
            member: {
                user: { id: SnowflakeUtil.generate().toString() },
                permissions: String(PermissionFlagsBits.Administrator),
            },
        };

        const refused = await interact(
            chatInputInteraction(
                "removemovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "Inception" }],
                someoneElse,
            ),
        );
        const byAdmin = await interact(
            chatInputInteraction(
                "removemovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "Inception" }],
                admin,
            ),
        );
        const byOwner = await interact(
            chatInputInteraction(
                "removemovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "Arrival" }],
                { member: { user: { id: SUBMITTER } } },
            ),
        );

        expect(discord.originalEdits(refused)).toEqual([
            expect.objectContaining({ content: "You can only remove movies you have added." }),
        ]);
        for (const removal of [byAdmin, byOwner]) {
            expect(discord.originalEdits(removal)).toEqual([
                expect.objectContaining({
                    content: expect.stringMatching(/^Movie \*\*.+\*\* has been removed from the list\.$/),
                }),
            ]);
        }
        expect(await services.repos.movieRepo.getAllMovies()).toEqual([]);
    });
});

describe("MovieRepository polls", () => {
    test("returns the most recently created active poll", async ({ services }) => {
        await services.repos.movieRepo.createPoll(
            moviePollFactory.build({ id: "older", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
        );
        await services.repos.movieRepo.createPoll(
            moviePollFactory.build({ id: "newer", createdAt: new Date("2026-01-05T00:00:00.000Z") }),
        );
        await services.repos.movieRepo.createPoll(
            moviePollFactory.build({ id: "closed", createdAt: new Date("2026-01-09T00:00:00.000Z"), isActive: false }),
        );

        const active = await services.repos.movieRepo.getActivePoll();
        expect(active?.id).toBe("newer");
        expect(active?.createdAt).toEqual(new Date("2026-01-05T00:00:00.000Z"));
        expect(active?.endsAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    });

    test("closes a poll once, returning it with its votes as it closed", async ({ services }) => {
        const poll = moviePollFactory.build({ votes: { [IDS.user]: "movie-2" } });
        await services.repos.movieRepo.createPoll(poll);

        expect(await services.repos.movieRepo.closePoll(poll.id)).toMatchObject({
            id: poll.id,
            votes: { [IDS.user]: "movie-2" },
        });
        expect(await services.repos.movieRepo.closePoll(poll.id)).toBeNull();
        expect(await services.repos.movieRepo.getActivePoll()).toBeNull();
    });

    test(
        "closes a poll closed twice at the same moment once",
        async ({ services }) => {
            const poll = moviePollFactory.build();
            await services.repos.movieRepo.createPoll(poll);

            const closed = await Promise.all([
                services.repos.movieRepo.closePoll(poll.id),
                services.repos.movieRepo.closePoll(poll.id),
            ]);

            expect(closed.filter(Boolean)).toHaveLength(1);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );

    test(
        "counts every vote when voters vote at the same time",
        async ({ services }) => {
            const poll = moviePollFactory.build();
            await services.repos.movieRepo.createPoll(poll);

            await Promise.all(
                Array.from({ length: 5 }, () =>
                    services.repos.movieRepo.voteInPollOnce(poll.id, SnowflakeUtil.generate().toString(), "movie-1"),
                ),
            );

            expect(Object.keys((await services.repos.movieRepo.getActivePoll())?.votes ?? {})).toHaveLength(5);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );
});
