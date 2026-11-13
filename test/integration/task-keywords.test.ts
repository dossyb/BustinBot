import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { describe, expect, test, vi, type StoringFactories } from "../fixtures.js";
import { AS, chatInputInteraction } from "../discord/payloads.js";
import { DateTime } from "luxon";

async function storeKeywordsUsedInOrder(factories: StoringFactories, words: string[]): Promise<void> {
    const lastUse = DateTime.fromISO("2026-01-01T00:00:00Z");
    for (const [index, word] of words.entries()) {
        await factories.keyword.create({
            id: word,
            word,
            lastUsedAt: lastUse.minus({ minutes: index }).toJSDate(),
            lastUsedEventId: `earlier-event-${index}`,
            timesUsed: 1,
            usageHistory: [`earlier-event-${index}`],
        });
    }
}

describe("/addkeyword", () => {
    test("adds the keyword to the pool under its normalised id", async ({ discord, interact, services }) => {
        const command = await interact(
            chatInputInteraction(
                "addkeyword",
                [{ type: ApplicationCommandOptionType.String, name: "word", value: "Bustin Bot!" }],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: 'Keyword **"Bustin Bot!"** has been added successfully!' }),
        ]);
        expect(await services.repos.keywordRepo.getKeywordById("bustin_bot")).toMatchObject({
            word: "Bustin Bot!",
            timesUsed: 0,
            lastUsedAt: new Date(0),
        });
    });

    test("refuses a keyword already in the pool", async ({ discord, interact, factories }) => {
        await factories.keyword.create({ id: "bustin", word: "Bustin" });

        const command = await interact(
            chatInputInteraction(
                "addkeyword",
                [{ type: ApplicationCommandOptionType.String, name: "word", value: "bustin" }],
                AS.taskAdmin,
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: 'The keyword **"bustin"** already exists in the database.' }),
        ]);
    });
});

describe("KeywordSelector", () => {
    test("falls back to a placeholder when no keywords are stored", async ({ services }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(await services.keywords.selectKeyword("event-1")).toBe("keyword");
        expect(warn).toHaveBeenCalledWith("[KeywordSelector] No keywords found in Firestore.");
    });

    test("never picks one of the 26 most recently used keywords, and records the pick", async ({
        services,
        factories,
    }) => {
        const words = Array.from({ length: 30 }, (_, index) => `word${String(index).padStart(2, "0")}`);

        for (const random of [0, 0.5, 0.99]) {
            await storeKeywordsUsedInOrder(factories, words);
            vi.spyOn(Math, "random").mockReturnValue(random);

            const picked = await services.keywords.selectKeyword(`event-${random}`);

            expect(words.slice(26)).toContain(picked);
            expect(await services.repos.keywordRepo.getKeywordById(picked)).toMatchObject({
                lastUsedEventId: `event-${random}`,
                timesUsed: 2,
            });
        }
    });

    test("never repeats the keyword used last when there are only a few", async ({ services, factories }) => {
        for (const random of [0, 0.5, 0.99]) {
            await storeKeywordsUsedInOrder(factories, ["alpha", "bravo", "charlie"]);
            vi.spyOn(Math, "random").mockReturnValue(random);

            expect(await services.keywords.selectKeyword("event-next")).not.toBe("alpha");
        }
    });
});

describe("KeywordRepository", () => {
    test("records usage with the most recent event first, keeping the last 20", async ({ services }) => {
        await services.repos.keywordRepo.addKeyword("rare");
        for (let event = 1; event <= 21; event++) {
            await services.repos.keywordRepo.markKeywordUsed("rare", `event-${event}`);
        }

        const keyword = await services.repos.keywordRepo.getKeywordById("rare");
        expect(keyword?.timesUsed).toBe(21);
        expect(keyword?.lastUsedEventId).toBe("event-21");
        expect(keyword?.usageHistory).toHaveLength(20);
        expect(keyword?.usageHistory[0]).toBe("event-21");
        expect(keyword?.lastUsedAt.getTime()).toBeGreaterThan(0);
    });
});
