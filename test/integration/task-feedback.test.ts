import { describe, expect, test } from "../fixtures.js";
import { CONCURRENT_TRANSACTION_TIMEOUT_MS } from "../firestoreEmulator.js";
import { IDS, buttonInteraction, PRIVATE_DEFERRAL } from "../discord/payloads.js";
import { taskFeedbackFactory } from "../factories.js";

describe("task feedback buttons", () => {
    test("thank a member for their first vote and raise the task's weight", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await factories.task.create({ id: "PVM001", weight: 50 });

        const click = await interact(buttonInteraction("task-feedback|up|PVM001|PVM001-20260105"));

        expect(discord.callbacks(click)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(click)).toEqual([
            expect.objectContaining({ content: "Thanks for your feedback!" }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({ weight: 51 });
    });

    test(
        "count two quick clicks of the same button once",
        async ({ discord, interact, services, factories }) => {
            await factories.task.create({ id: "PVM001", weight: 50 });

            const [first, second] = await Promise.all([
                interact(buttonInteraction("task-feedback|up|PVM001|PVM001-20260105")),
                interact(buttonInteraction("task-feedback|up|PVM001|PVM001-20260105")),
            ]);

            const replies = [first, second].map((click) => discord.originalEdits(click)[0]?.content);
            expect(replies).toHaveLength(2);
            expect(replies).toEqual(
                expect.arrayContaining(["Thanks for your feedback!", "You already gave this task a 👍."]),
            );
            expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({ weight: 51 });
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );

    test("let a member change their vote", async ({ discord, interact, services, factories }) => {
        await factories.task.create({ id: "PVM001", weight: 50 });
        await interact(buttonInteraction("task-feedback|up|PVM001|PVM001-20260105"));

        const change = await interact(buttonInteraction("task-feedback|down|PVM001|PVM001-20260105"));

        expect(discord.originalEdits(change)).toEqual([expect.objectContaining({ content: "Feedback updated!" })]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({ weight: 49 });
    });

    test("still work on posts made before the button ids changed", async ({ discord, interact, db, factories }) => {
        await factories.task.create({ id: "PVM001", weight: 50 });

        const click = await interact(buttonInteraction("task-feedback-down-PVM001-20251006"));

        expect(discord.originalEdits(click)).toEqual([
            expect.objectContaining({ content: "Thanks for your feedback!" }),
        ]);
        expect((await db.doc(`guilds/${IDS.guild}/taskFeedback/PVM001_${IDS.user}`).get()).data()).toMatchObject({
            taskId: "PVM001",
            eventId: "PVM001-20251006",
            vote: "down",
        });
    });

    test("treat a vote stored under an older id as the member's previous vote, and move it", async ({
        discord,
        interact,
        services,
        db,
        factories,
    }) => {
        await factories.task.create({ id: "PVM001", weight: 51 });
        await db.doc(`guilds/${IDS.guild}/taskFeedback/1730000000000`).set({
            id: "1730000000000",
            ...taskFeedbackFactory.build({ eventId: "week-1", vote: "up" }),
        });

        const change = await interact(buttonInteraction("task-feedback|down|PVM001|week-1"));

        expect(discord.originalEdits(change)).toEqual([expect.objectContaining({ content: "Feedback updated!" })]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({ weight: 49 });
        expect((await db.collection(`guilds/${IDS.guild}/taskFeedback`).get()).docs.map((doc) => doc.id)).toEqual([
            `PVM001_${IDS.user}`,
        ]);
    });

    test("reject a direction they don't know", async ({ discord, interact }) => {
        const click = await interact(buttonInteraction("task-feedback|sideways|PVM001|PVM001-20260105"));

        expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Unknown feedback type." })]);
    });

    test("say so when the task no longer exists", async ({ discord, interact }) => {
        const click = await interact(buttonInteraction("task-feedback|up|PVM404|PVM404-20260105"));

        expect(discord.originalEdits(click)).toEqual([expect.objectContaining({ content: "Task not found." })]);
    });
});
