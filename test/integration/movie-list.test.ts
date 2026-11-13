import { SnowflakeUtil } from "discord.js";
import { ApplicationCommandOptionType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, type StoringFactories, test } from "../fixtures.js";
import { AS, IDS, apiMessage, buttonInteraction, chatInputInteraction } from "../discord/payloads.js";
import { tmdbMovie, tmdbSearch } from "../tmdb.js";
import { movieFactory } from "../factories.js";

const matrix = { id: 603, title: "The Matrix", release_date: "1999-03-31", overview: "A hacker learns the truth." };
const reloaded = { id: 604, title: "The Matrix Reloaded", release_date: "2003-05-15", overview: "Neo returns." };
const resultsMessage = apiMessage({ flags: MessageFlags.Ephemeral });

async function storeFullList(factories: StoringFactories, userId: string): Promise<void> {
    for (let i = 0; i < 3; i++)
        await factories.movie.create({ id: `${userId}-${i}`, tmdbId: 900 + i, addedBy: userId });
}

const arrival = { id: 329865, title: "Arrival", release_date: "2016-11-10", overview: "Linguists meet visitors." };

describe("/addmovie", () => {
    test("shows TMDb's results and adds the one the member picks", async ({ discord, interact, services, http }) => {
        tmdbSearch(http, "The Matrix", [matrix, reloaded]);
        tmdbMovie(http, matrix, 136, "Lana Wachowski");

        const command = await interact(
            chatInputInteraction("addmovie", [
                { type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" },
            ]),
        );
        const [results] = discord.originalEdits(command);
        const pick = await interact(buttonInteraction("addmovie|select|603", resultsMessage));

        expect(results?.embeds?.map((embed) => embed.title)).toEqual([
            "The Matrix (1999)",
            "The Matrix Reloaded (2003)",
        ]);
        expect(results?.components).toMatchObject([
            {
                components: [
                    { custom_id: "addmovie|select|603" },
                    { custom_id: "addmovie|select|604" },
                    { custom_id: "addmovie|cancel" },
                ],
            },
        ]);
        expect(discord.callbacks(pick)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        expect(discord.originalEdits(pick)).toEqual([
            expect.objectContaining({
                embeds: [expect.objectContaining({ title: "Added: The Matrix" })],
                components: [],
            }),
        ]);
        const [added] = await services.repos.movieRepo.getAllMovies();
        expect(added).toMatchObject({
            tmdbId: 603,
            title: "The Matrix",
            releaseDate: 1999,
            runtime: 136,
            director: "Lana Wachowski",
            cast: ["Keanu Reeves"],
            addedBy: IDS.user,
            watched: false,
        });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ moviesAdded: 1 });
    });

    test("refuses a movie already in the list, but not one already watched", async ({
        discord,
        interact,
        http,
        factories,
    }) => {
        const lister = SnowflakeUtil.generate().toString();
        await factories.movie.create({ id: "listed", tmdbId: 603, title: "The Matrix", addedBy: lister });
        await factories.movie.create({ id: "seen", tmdbId: 604, title: "The Matrix Reloaded", watched: true });
        tmdbMovie(http, reloaded, 138, "Lana Wachowski");

        const duplicate = await interact(buttonInteraction("addmovie|select|603", resultsMessage));
        const rewatch = await interact(buttonInteraction("addmovie|select|604", resultsMessage));

        expect(discord.followUps(duplicate)).toEqual([
            expect.objectContaining({
                content: `**The Matrix** is already in the movie list (added by <@${lister}>). Please choose a different result.`,
            }),
        ]);
        expect(discord.originalEdits(rewatch)).toEqual([
            expect.objectContaining({ embeds: [expect.objectContaining({ title: "Added: The Matrix Reloaded" })] }),
        ]);
    });

    test("stops a member at three movies in the list, unless they are a movie admin or the server owner", async ({
        discord,
        interact,
        http,
        factories,
    }) => {
        await storeFullList(factories, IDS.user);
        await storeFullList(factories, IDS.owner);
        tmdbSearch(http, "The Matrix", [matrix]);
        tmdbSearch(http, "The Matrix", [matrix]);

        const member = await interact(
            chatInputInteraction("addmovie", [
                { type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" },
            ]),
        );
        const admin = await interact(
            chatInputInteraction(
                "addmovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" }],
                AS.movieAdmin,
            ),
        );
        const owner = await interact(
            chatInputInteraction(
                "addmovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" }],
                { member: { user: { id: IDS.owner } } },
            ),
        );

        expect(discord.originalEdits(member)).toEqual([
            expect.objectContaining({
                content:
                    "You have reached the maximum of 3 active movies. Remove one or wait for a movie night to conclude before adding more.",
            }),
        ]);
        expect(discord.originalEdits(admin)[0]?.embeds).toHaveLength(1);
        expect(discord.originalEdits(owner)[0]?.embeds).toHaveLength(1);
    });

    test("recognises a movie admin whose member Discord sends as role ids", async ({
        discord,
        interact,
        uncachedGuild,
        http,
        factories,
    }) => {
        await storeFullList(factories, IDS.user);
        tmdbSearch(http, "The Matrix", [matrix]);

        const command = await interact(
            chatInputInteraction(
                "addmovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" }],
                { ...uncachedGuild, ...AS.movieAdmin },
            ),
        );

        expect(discord.originalEdits(command)[0]?.embeds).toHaveLength(1);
    });

    test("can be cancelled", async ({ discord, interact }) => {
        const cancel = await interact(buttonInteraction("addmovie|cancel", resultsMessage));

        expect(discord.callbacks(cancel)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({ content: "Cancelled movie selection.", components: [] }),
            },
        ]);
    });

    test("is refused until the bot is set up", async ({ discord, interact, db }) => {
        await db.doc(`guilds/${IDS.guild}`).delete();

        const command = await interact(
            chatInputInteraction("addmovie", [
                { type: ApplicationCommandOptionType.String, name: "title", value: "The Matrix" },
            ]),
        );

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content:
                        "The bot has not been set up yet. Please run `/setup` first to configure the core channels.",
                }),
            },
        ]);
    });
});

describe("/mymovies", () => {
    test("lists the member's movies still in the list, counted against the cap", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.movie.create({ id: "movie-1", title: "Inception", addedBy: IDS.user, watched: false });
        await factories.movie.create({ id: "movie-2", title: "Arrival", addedBy: IDS.user, watched: false });
        await factories.movie.create({ id: "movie-3", title: "Heat", addedBy: IDS.user, watched: true });
        await factories.movie.create({ id: "movie-4", title: "Alien", addedBy: SnowflakeUtil.generate().toString() });

        const command = await interact(chatInputInteraction("mymovies"));

        const [reply] = discord.originalEdits(command);
        expect(reply?.content).toBe("You have added **2/3** movies. You can still add **1** more using /addmovie.");
        expect(reply?.embeds?.map((embed) => embed.title)).toEqual(["Inception", "Arrival"]);
    });

    test("says how many the member can add when they have none", async ({ discord, interact, factories }) => {
        await factories.movie.create({ title: "Heat", addedBy: IDS.user, watched: true });

        const command = await interact(chatInputInteraction("mymovies"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: "You haven't added any movies yet. You can add up to 3 movies using /addmovie.",
            }),
        ]);
    });

    test("shows a movie night admin, who has no cap, just how many they have", async ({
        discord,
        interact,
        factories,
    }) => {
        for (const [index, title] of ["Inception", "Arrival", "Heat", "Alien"].entries()) {
            await factories.movie.create({ id: `movie-${index + 1}`, title, addedBy: IDS.user, watched: false });
        }

        const command = await interact(chatInputInteraction("mymovies", [], AS.movieAdmin));

        const [reply] = discord.originalEdits(command);
        expect(reply?.content).toBe("You have added **4** movies.");
        expect(reply?.embeds?.map((embed) => embed.title)).toEqual(["Inception", "Arrival", "Heat", "Alien"]);
    });
});

describe("/viewmovie", () => {
    test("shows the closest match to a misspelt title, with who added it", async ({ discord, interact, factories }) => {
        const submitter = SnowflakeUtil.generate().toString();
        await factories.movie.create({ id: "movie-1", title: "Inception" });
        await factories.movie.create({
            id: "movie-2",
            title: "Arrival",
            overview: "Linguists meet visitors.",
            addedBy: submitter,
        });

        const command = await interact(
            chatInputInteraction("viewmovie", [
                { type: ApplicationCommandOptionType.String, name: "title", value: "arival" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "🎬 Arrival",
                        description: `Linguists meet visitors.\n\n*Added by <@${submitter}>*`,
                    }),
                ],
            }),
        ]);
    });

    test("says so when nothing matches", async ({ discord, interact, factories }) => {
        await factories.movie.create({ title: "Inception" });

        const command = await interact(
            chatInputInteraction("viewmovie", [
                { type: ApplicationCommandOptionType.String, name: "title", value: "Godfather" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No matching movie found for **Godfather**." }),
        ]);
    });

    test("says so when the list is empty", async ({ discord, interact }) => {
        const command = await interact(
            chatInputInteraction("viewmovie", [
                { type: ApplicationCommandOptionType.String, name: "title", value: "Inception" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No movies are currently in the watchlist." }),
        ]);
    });
});

describe("/testmovie", () => {
    test("previews what /addmovie would store for TMDb's top result", async ({ discord, interact, http }) => {
        tmdbSearch(http, "arrival", [arrival]);
        tmdbMovie(http, arrival, 116, "Denis Villeneuve");

        const command = await interact(
            chatInputInteraction(
                "testmovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "arrival" }],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "Arrival (2016)",
                        description: "Linguists meet visitors.",
                        url: "https://www.themoviedb.org/movie/329865",
                        fields: [
                            { name: "Runtime", value: "116 mins", inline: true },
                            { name: "Director", value: "Denis Villeneuve", inline: true },
                            { name: "Rating", value: "8.2/10", inline: true },
                            { name: "Genres", value: "Action", inline: true },
                            { name: "Starring", value: "Keanu Reeves", inline: true },
                        ],
                    }),
                ],
            }),
        ]);
    });

    test("says so when TMDb finds nothing", async ({ discord, interact, http }) => {
        tmdbSearch(http, "zzzz", []);

        const command = await interact(
            chatInputInteraction(
                "testmovie",
                [{ type: ApplicationCommandOptionType.String, name: "title", value: "zzzz" }],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No movie found for **zzzz**." }),
        ]);
    });
});

describe("MovieRepository movies", () => {
    test("stores a movie whose optional TMDb details are missing", async ({ services }) => {
        await services.repos.movieRepo.upsertMovie(
            movieFactory.build({
                id: "arrival",
                title: "Arrival",
                director: undefined,
                runtime: undefined,
                posterUrl: undefined,
            }),
        );

        expect(await services.repos.movieRepo.getMovieById("arrival")).toMatchObject({ title: "Arrival" });
    });
});
