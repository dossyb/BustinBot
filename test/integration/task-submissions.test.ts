import assert from "node:assert";
import { SnowflakeUtil } from "discord.js";
import {
    InteractionResponseType,
    MessageFlags,
    RESTJSONErrorCodes,
    type APIAttachment,
    type GatewayMessageCreateDispatchData,
    ApplicationCommandOptionType,
} from "discord-api-types/v10";
import {
    describe,
    expect,
    vi,
    type StoringFactories,
    type Interact,
    storePeriodic,
    storeRunningEvent,
    storeTaskWeek,
    test,
} from "../fixtures.js";
import { type ServiceContainer } from "../../src/core/services/ServiceContainer.js";
import { type DiscordHarness } from "../discord/harness.js";
import { CONCURRENT_TRANSACTION_TIMEOUT_MS, firestoreUnavailable } from "../firestoreEmulator.js";
import {
    DiscordError,
    IDS,
    apiAttachment,
    apiGuildMember,
    apiMessage,
    apiTextChannel,
    apiUser,
    buttonInteraction,
    directMessage,
    modalSubmitInteraction,
    chatInputInteraction,
    AS,
    PRIVATE_DEFERRAL,
} from "../discord/payloads.js";
import { taskSubmissionFactory, submissionDraftFactory } from "../factories.js";
import { SubmissionStatus, type TaskSubmission } from "../../src/models/TaskSubmission.js";
import { handleDirectMessage } from "../../src/modules/tasks/TaskInteractions.js";
import { DateTime } from "luxon";
import { TaskCategory } from "../../src/models/Task.js";

const EVENT = "PVM001-20260105-a1b2c3d4";
const EVENT_POST = SnowflakeUtil.generate().toString();
const REVIEW_POST = SnowflakeUtil.generate().toString();
const SCREENSHOT_POST = SnowflakeUtil.generate().toString();
const ARCHIVE = SnowflakeUtil.generate().toString();
const reviewer = SnowflakeUtil.generate().toString();
const admin = { member: { user: { id: reviewer, username: "admin" }, roles: [IDS.roles.taskAdmin] } };

const runningEvent = { id: EVENT, task: { id: "PVM001", taskName: "Kill Zulrah" }, messageId: EVENT_POST };

async function storePendingSubmission(
    factories: StoringFactories,
    overrides: Partial<TaskSubmission> = {},
): Promise<TaskSubmission> {
    return factories.taskSubmission.create({
        userId: IDS.user,
        taskEventId: EVENT,
        taskName: "Kill Zulrah",
        submittedAt: new Date(),
        message: REVIEW_POST,
        screenshotMessage: SCREENSHOT_POST,
        ...overrides,
    });
}

async function storeApproval(
    services: ServiceContainer,
    factories: StoringFactories,
    tier: SubmissionStatus.Bronze | SubmissionStatus.Silver,
) {
    await factories.taskSubmission.create({
        id: `held-${tier}`,
        userId: IDS.user,
        taskEventId: EVENT,
        status: tier,
        reviewedAt: new Date(),
    });
    const event = await services.repos.taskRepo.getTaskEventById(EVENT);
    assert(event);
    await factories.taskEvent.create({
        ...event,
        completionCounts: {
            bronze: tier === SubmissionStatus.Bronze ? 1 : 0,
            silver: tier === SubmissionStatus.Silver ? 1 : 0,
            gold: 0,
        },
        completedUserIds: [IDS.user],
    });
    const field = tier === SubmissionStatus.Bronze ? "tasksCompletedBronze" : "tasksCompletedSilver";
    await factories.userStats.create({ userId: IDS.user, [field]: 1 });
}

async function acceptReviewEffects(
    discord: DiscordHarness,
    services: ServiceContainer,
): Promise<{ dm: string; screenshot: APIAttachment }> {
    await discord.addChannel(apiTextChannel({ id: ARCHIVE, name: "bot-archive" }));
    await services.guilds.update(IDS.guild, { channels: { botArchive: ARCHIVE } });
    discord.serveMember(IDS.guild, apiGuildMember());
    const dm = discord.acceptDirectMessages(apiUser());
    const screenshot = apiAttachment();
    discord.serveMessage(apiMessage({ id: SCREENSHOT_POST, attachments: [screenshot] }));
    discord.serveAttachment(screenshot);
    discord.serveMessage(apiMessage({ id: EVENT_POST }));
    discord.acceptMessages(ARCHIVE);
    discord.acceptMessages(IDS.channel);
    discord.acceptMessageEdits(IDS.channel);
    discord.acceptMessageDeletions(IDS.channel);
    return { dm, screenshot };
}

const otherUser = SnowflakeUtil.generate().toString();

describe("submitting a task", () => {
    async function sendDirectMessage(
        discord: DiscordHarness,
        services: ServiceContainer,
        payload: GatewayMessageCreateDispatchData,
    ): Promise<void> {
        await handleDirectMessage(await discord.sendMessage(payload), discord.client, services);
    }

    test("asks for screenshots in DMs, then posts them for review and stores the submission", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeRunningEvent(factories, runningEvent);
        const dm = discord.acceptDirectMessages(apiUser());

        const click = await interact(buttonInteraction(`task-submit-${EVENT}`));

        expect(discord.callbacks(click)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(click)).toEqual([
            expect.objectContaining({ content: "Check your DMs to submit your screenshot(s) for **Kill Zulrah**!" }),
        ]);
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({
                content:
                    "Please upload your screenshot(s) for **Kill Zulrah** and include any notes/comments in the same message.",
            }),
        ]);

        const screenshots = [apiAttachment({ filename: "before.png" }), apiAttachment({ filename: "after.png" })];
        for (const screenshot of screenshots) discord.serveAttachment(screenshot);
        discord.acceptMessages(IDS.channel);
        discord.acceptMessages(IDS.dm);

        await sendDirectMessage(
            discord,
            services,
            directMessage("Got it on the first kill", { attachments: screenshots }),
        );

        const [submission, ...others] = await services.repos.taskRepo.getSubmissionsByUser(IDS.user);
        assert(submission);
        expect(others).toEqual([]);
        expect(submission).toMatchObject({
            taskEventId: EVENT,
            taskName: "Kill Zulrah",
            status: SubmissionStatus.Pending,
            notes: "Got it on the first kill",
            screenshotUrls: screenshots.map((screenshot) => screenshot.url),
            message: expect.any(String),
            screenshotMessage: expect.any(String),
        });
        const [details, posted] = discord.messagesSentTo(IDS.channel);
        expect(details?.components).toMatchObject([
            {
                components: [
                    { custom_id: `approve_bronze_${submission.id}` },
                    { custom_id: `approve_silver_${submission.id}` },
                    { custom_id: `approve_gold_${submission.id}` },
                    { custom_id: `reject_${submission.id}` },
                ],
            },
        ]);
        expect(posted).toMatchObject({
            content: `Submission screenshots for <@${IDS.user}> — Kill Zulrah:`,
            files: ["before.png", "after.png"],
        });
        expect(discord.messagesSentTo(IDS.dm)).toEqual([
            expect.objectContaining({
                content: "✅ Submission for **Kill Zulrah** received with 2 screenshots and sent for review!",
            }),
        ]);
        expect(await services.tasks.peekPendingTask(IDS.user)).toBeUndefined();
    });

    test("asks again when the DM has no image, and takes the screenshots sent next", async ({
        discord,
        services,
        factories,
    }) => {
        await storeRunningEvent(factories, runningEvent);
        await services.tasks.setPendingTask(IDS.user, EVENT);
        const screenshot = apiAttachment();
        discord.serveAttachment(screenshot);
        discord.acceptMessages(IDS.channel);
        discord.acceptMessages(IDS.dm);

        await sendDirectMessage(discord, services, directMessage("Forgot the picture"));
        await sendDirectMessage(discord, services, directMessage("", { attachments: [screenshot] }));

        expect(discord.messagesSentTo(IDS.dm).map((reply) => reply.content)).toEqual([
            "Please attach at least one image for your submission.",
            "✅ Submission for **Kill Zulrah** received with 1 screenshot and sent for review!",
        ]);
        expect(await services.repos.taskRepo.getSubmissionsByUser(IDS.user)).toHaveLength(1);
    });

    test("tells the member to send again when the Task Admins can't be reached, and takes the next try", async ({
        discord,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await storeRunningEvent(factories, runningEvent);
        await services.tasks.setPendingTask(IDS.user, EVENT);
        const screenshot = apiAttachment();
        discord.serveAttachment(screenshot);
        discord.refuse("POST", `/channels/${IDS.channel}/messages`, DiscordError.missingPermissions);
        discord.acceptMessages(IDS.dm);

        await sendDirectMessage(discord, services, directMessage("", { attachments: [screenshot] }));

        expect(discord.messagesSentTo(IDS.dm)).toEqual([
            expect.objectContaining({
                content:
                    "I couldn't pass your submission on to the Task Admins just now. Please send it again later, or contact a Task Admin.",
            }),
        ]);
        expect(await services.repos.taskRepo.getSubmissionsByUser(IDS.user)).toEqual([]);
        expect(warn).toHaveBeenCalledWith(
            expect.stringMatching(/^\[TaskService\] Couldn't post submission [\w-]+ for review:$/),
            expect.objectContaining({ code: RESTJSONErrorCodes.MissingPermissions }),
        );

        discord.acceptMessages(IDS.channel);
        await sendDirectMessage(discord, services, directMessage("", { attachments: [screenshot] }));

        expect(await services.repos.taskRepo.getSubmissionsByUser(IDS.user)).toHaveLength(1);
    });

    test(
        "takes one submission when two DMs arrive at once, removing the other's review post",
        async ({ discord, services, factories }) => {
            await storeRunningEvent(factories, runningEvent);
            await services.tasks.setPendingTask(IDS.user, EVENT);
            const screenshot = apiAttachment();
            discord.serveAttachment(screenshot);
            discord.acceptMessages(IDS.channel);
            discord.acceptMessageDeletions(IDS.channel);
            discord.acceptMessages(IDS.dm);
            const messages = [
                await discord.sendMessage(directMessage("first", { attachments: [screenshot] })),
                await discord.sendMessage(directMessage("second", { attachments: [screenshot] })),
            ];

            await Promise.all(messages.map((message) => handleDirectMessage(message, discord.client, services)));

            const replies = discord.messagesSentTo(IDS.dm).map((reply) => reply.content);
            expect(replies).toHaveLength(2);
            expect(replies).toEqual(
                expect.arrayContaining([
                    "I've already received your submission for this task. To send another, click Submit on the task again.",
                    "✅ Submission for **Kill Zulrah** received with 1 screenshot and sent for review!",
                ]),
            );
            const [submission, ...others] = await services.repos.taskRepo.getSubmissionsByUser(IDS.user);
            assert(submission);
            expect(others).toEqual([]);
            expect(discord.messagesSentTo(IDS.channel)).toHaveLength(4);
            expect(discord.messageDeletions(IDS.channel)).toHaveLength(2);
            expect(discord.messageDeletions(IDS.channel)).not.toContain(submission.message);
            expect(discord.messageDeletions(IDS.channel)).not.toContain(submission.screenshotMessage);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );

    test("removes the review post and keeps the draft when the submission can't be stored", async ({
        discord,
        services,
        factories,
    }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        await storeRunningEvent(factories, runningEvent);
        await services.tasks.setPendingTask(IDS.user, EVENT);
        const screenshot = apiAttachment();
        discord.serveAttachment(screenshot);
        discord.acceptMessages(IDS.channel);
        discord.acceptMessageDeletions(IDS.channel);
        discord.acceptMessages(IDS.dm);
        const unavailable = firestoreUnavailable();
        vi.spyOn(services.repos.taskRepo, "submitDraft").mockRejectedValueOnce(unavailable);

        await sendDirectMessage(discord, services, directMessage("", { attachments: [screenshot] }));

        expect(discord.messagesSentTo(IDS.dm)).toEqual([
            expect.objectContaining({ content: "Something went wrong saving your submission. Please send it again." }),
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toHaveLength(2);
        expect(discord.messageDeletions(IDS.channel)).toHaveLength(2);
        expect(await services.repos.taskRepo.getSubmissionsByUser(IDS.user)).toEqual([]);
        expect(await services.tasks.peekPendingTask(IDS.user)).toBe(EVENT);
        expect(error).toHaveBeenCalledWith("[TaskDM] Failed to store submission:", unavailable);
    });

    test("tells the member to send again when no verification channel is set up", async ({
        discord,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await storeRunningEvent(factories, runningEvent);
        await services.guilds.update(IDS.guild, { channels: { taskVerification: "" } });
        await services.tasks.setPendingTask(IDS.user, EVENT);
        discord.acceptMessages(IDS.dm);

        await sendDirectMessage(discord, services, directMessage("", { attachments: [apiAttachment()] }));

        expect(discord.messagesSentTo(IDS.dm)).toEqual([
            expect.objectContaining({
                content:
                    "I couldn't pass your submission on to the Task Admins just now. Please send it again later, or contact a Task Admin.",
            }),
        ]);
        expect(warn).toHaveBeenCalledWith(
            `[Channels] The taskVerification channel (not set) of guild ${IDS.guild} isn't set or can't be reached.`,
        );
        expect(await services.tasks.peekPendingTask(IDS.user)).toBe(EVENT);
    });

    test("ignores DMs from members who haven't clicked Submit", async ({ discord, services }) => {
        await sendDirectMessage(discord, services, directMessage("hello", { attachments: [apiAttachment()] }));

        expect(discord.requests).toEqual([]);
    });

    test("warns the Task Admins when the member already holds a tier for the task", async ({
        discord,
        services,
        factories,
    }) => {
        await storeRunningEvent(factories, runningEvent);
        await storeApproval(services, factories, SubmissionStatus.Bronze);
        await services.tasks.setPendingTask(IDS.user, EVENT);
        const screenshot = apiAttachment();
        discord.serveAttachment(screenshot);
        discord.acceptMessages(IDS.channel);
        discord.acceptMessages(IDS.dm);

        await sendDirectMessage(discord, services, directMessage("Going for gold", { attachments: [screenshot] }));

        const [details] = discord.messagesSentTo(IDS.channel);
        expect(details?.embeds?.[0]?.fields).toContainEqual({
            name: "⚠️ WARNING",
            value: "This user already holds **🥉 Bronze** for this task.",
        });
    });
});

describe("approving a submission", () => {
    async function approve(discord: DiscordHarness, interact: Interact, submission: TaskSubmission, tier: string) {
        const prompt = await interact(
            buttonInteraction(`approve_${tier}_${submission.id}`, apiMessage({ id: REVIEW_POST }), admin),
        );
        const confirm = `review-confirm|approve|${tier}|${submission.id}`;
        expect(discord.reply(prompt)?.components).toMatchObject([{ components: [{ custom_id: confirm }, {}] }]);
        return interact(buttonInteraction(confirm, apiMessage({ flags: MessageFlags.Ephemeral }), admin));
    }

    test("asks the admin to confirm, then records the tier and everything that follows from it", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeRunningEvent(factories, runningEvent);
        const submission = await storePendingSubmission(factories);
        const { dm, screenshot } = await acceptReviewEffects(discord, services);

        const prompt = await interact(
            buttonInteraction(`approve_silver_${submission.id}`, apiMessage({ id: REVIEW_POST }), admin),
        );

        expect(discord.callbacks(prompt)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "Are you sure you want to approve this submission for **Silver** tier?",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        expect(await services.repos.taskRepo.getSubmissionById(submission.id)).toMatchObject({
            status: SubmissionStatus.Pending,
        });

        const confirmButton = `review-confirm|approve|silver|${submission.id}`;
        expect(discord.reply(prompt)?.components).toMatchObject([
            { components: [{ custom_id: confirmButton }, { custom_id: `review-cancel|${submission.id}` }] },
        ]);
        const confirm = await interact(
            buttonInteraction(confirmButton, apiMessage({ flags: MessageFlags.Ephemeral }), admin),
        );

        expect(discord.callbacks(confirm)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        expect(discord.originalEdits(confirm)[0]).toMatchObject({
            content: "⏳ Processing approval...",
            components: [],
        });
        expect(discord.originalEdits(confirm).at(-1)).toMatchObject({
            content: "✅ Submission approved for **Silver tier** (1 roll) and archived.",
            components: [],
        });
        expect(await services.repos.taskRepo.getSubmissionById(submission.id)).toMatchObject({
            status: SubmissionStatus.Silver,
            reviewedBy: reviewer,
        });
        expect(await services.repos.taskRepo.getTaskEventById(EVENT)).toMatchObject({
            completionCounts: { bronze: 0, silver: 1, gold: 0 },
            completedUserIds: [IDS.user],
        });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({
            tasksCompletedSilver: 1,
            taskStreak: 1,
        });
        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("lifetime")).toMatchObject({
            points: { [IDS.user]: 3 },
        });
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({
                content: expect.stringMatching(
                    /^✅ Your submission for \*\*Kill Zulrah\*\* has been approved for 🥈 \*\*Silver tier\*\*!\n🔥 Task streak: \*\*1\*\*/,
                ),
            }),
        ]);
        const [archived, archivedScreenshots] = discord.messagesSentTo(ARCHIVE);
        expect(archived?.embeds?.[0]).toMatchObject({ title: "Task Submission (silver)" });
        expect(archivedScreenshots).toMatchObject({
            content: `Archived screenshots for <@${IDS.user}>:`,
            files: [screenshot.filename],
        });
        expect(discord.messageDeletions(IDS.channel)).toEqual([REVIEW_POST, SCREENSHOT_POST]);
        expect(discord.messageEdits(IDS.channel, EVENT_POST)[0]?.embeds?.[0]?.description).toContain(
            "**Completions:** 🥉0 🥈1 🥇0",
        );
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                content: `✅ <@${reviewer}> approved **Silver tier** for submission by <@${IDS.user}> on **Kill Zulrah** (1 roll).`,
            }),
        ]);
    });

    test("moves the member's counts, stats and points up to a higher tier rather than adding to them", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeRunningEvent(factories, runningEvent);
        await storeApproval(services, factories, SubmissionStatus.Bronze);
        await factories.periodicLeaderboard.create({
            points: { [IDS.user]: 1 },
            tierCounts: { [IDS.user]: { bronze: 1, silver: 0, gold: 0 } },
            period: { eventIds: [EVENT] },
        });
        await factories.lifetimeLeaderboard.create({ points: { [IDS.user]: 1 } });
        const submission = await storePendingSubmission(factories);
        await acceptReviewEffects(discord, services);

        await approve(discord, interact, submission, "gold");

        expect(await services.repos.taskRepo.getTaskEventById(EVENT)).toMatchObject({
            completionCounts: { bronze: 0, silver: 0, gold: 1 },
        });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({
            tasksCompletedBronze: 0,
            tasksCompletedGold: 1,
        });
        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("lifetime")).toMatchObject({
            points: { [IDS.user]: 6 },
        });
        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("periodic")).toMatchObject({
            points: { [IDS.user]: 6 },
            tierCounts: { [IDS.user]: { bronze: 0, silver: 0, gold: 1 } },
        });
    });

    test("starts the lifetime leaderboard from the member's stats before this approval", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeRunningEvent(factories, runningEvent);
        await factories.userStats.create({ userId: IDS.user, tasksCompletedBronze: 2 });
        const submission = await storePendingSubmission(factories);
        await acceptReviewEffects(discord, services);

        await approve(discord, interact, submission, "gold");

        expect(await services.repos.taskLeaderboardRepo.getLeaderboard("lifetime")).toMatchObject({
            points: { [IDS.user]: 2 + 6 },
        });
    });

    test(
        "counts once when two admins confirm at the same moment",
        async ({ discord, interact, services, factories }) => {
            await storeRunningEvent(factories, runningEvent);
            const submission = await storePendingSubmission(factories);
            const { dm } = await acceptReviewEffects(discord, services);
            const prompt = await interact(
                buttonInteraction(`approve_bronze_${submission.id}`, apiMessage({ id: REVIEW_POST }), admin),
            );
            const confirmButton = `review-confirm|approve|bronze|${submission.id}`;
            expect(discord.reply(prompt)?.components).toMatchObject([
                { components: [{ custom_id: confirmButton }, {}] },
            ]);

            const confirms = await Promise.all([
                interact(buttonInteraction(confirmButton, apiMessage({ flags: MessageFlags.Ephemeral }), admin)),
                interact(buttonInteraction(confirmButton, apiMessage({ flags: MessageFlags.Ephemeral }), admin)),
            ]);

            const replies = confirms.map((confirm) => discord.originalEdits(confirm).at(-1)?.content);
            expect(replies).toHaveLength(2);
            expect(replies).toEqual(
                expect.arrayContaining([
                    "⚠️ This submission has already been reviewed (bronze). Another admin may have processed it.",
                    "✅ Submission approved for **Bronze tier** (1 roll) and archived.",
                ]),
            );
            expect(await services.repos.taskRepo.getTaskEventById(EVENT)).toMatchObject({
                completionCounts: { bronze: 1, silver: 0, gold: 0 },
            });
            expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ tasksCompletedBronze: 1 });
            expect(await services.repos.taskLeaderboardRepo.getLeaderboard("lifetime")).toMatchObject({
                points: { [IDS.user]: 1 },
            });
            expect(discord.messagesSentTo(dm)).toHaveLength(1);
        },
        CONCURRENT_TRANSACTION_TIMEOUT_MS,
    );

    test("resolves a submission approved below the member's tier without changing their tier", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeRunningEvent(factories, runningEvent);
        await storeApproval(services, factories, SubmissionStatus.Silver);
        const submission = await storePendingSubmission(factories);
        const { dm } = await acceptReviewEffects(discord, services);

        const confirm = await approve(discord, interact, submission, "bronze");

        expect(discord.originalEdits(confirm).at(-1)).toMatchObject({
            content:
                "✅ Submission approved for **Bronze tier** and archived. The member already holds 🥈 Silver for this task, so their tier is unchanged.",
        });
        expect(await services.repos.taskRepo.getSubmissionById(submission.id)).toMatchObject({
            status: SubmissionStatus.Bronze,
        });
        expect(await services.repos.taskRepo.getTaskEventById(EVENT)).toMatchObject({
            completionCounts: { bronze: 0, silver: 1, gold: 0 },
        });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({
            tasksCompletedBronze: 0,
            tasksCompletedSilver: 1,
        });
        expect(discord.messageDeletions(IDS.channel)).toEqual([REVIEW_POST, SCREENSHOT_POST]);
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({
                content:
                    "✅ Your submission for **Kill Zulrah** has been approved for 🥉 **Bronze tier**. You already hold 🥈 **Silver tier** for this task, so your tier is unchanged.",
            }),
        ]);
    });

    test("still counts from the member's highest tier after an approval below it", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeRunningEvent(factories, runningEvent);
        await storeApproval(services, factories, SubmissionStatus.Silver);
        const below = await storePendingSubmission(factories, { id: "below" });
        const above = await storePendingSubmission(factories, { id: "above" });
        await acceptReviewEffects(discord, services);

        await approve(discord, interact, below, "bronze");
        await approve(discord, interact, above, "gold");

        expect(await services.repos.taskRepo.getTaskEventById(EVENT)).toMatchObject({
            completionCounts: { bronze: 0, silver: 0, gold: 1 },
        });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({
            tasksCompletedBronze: 0,
            tasksCompletedSilver: 0,
            tasksCompletedGold: 1,
        });
    });

    test("still completes when the member can't be DMed and the archive channel refuses the copy", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await storeRunningEvent(factories, runningEvent);
        const submission = await storePendingSubmission(factories);
        // Registered first, so these answer before the routes that accept
        discord.refuseDirectMessages(apiUser());
        discord.refuse("POST", `/channels/${ARCHIVE}/messages`, DiscordError.missingPermissions);
        await acceptReviewEffects(discord, services);

        const confirm = await approve(discord, interact, submission, "gold");

        expect(discord.originalEdits(confirm).at(-1)).toMatchObject({
            content: "✅ Submission approved for **Gold tier** (1 roll). It couldn't be archived; check the logs.",
        });
        expect(await services.repos.taskRepo.getTaskEventById(EVENT)).toMatchObject({
            completionCounts: { bronze: 0, silver: 0, gold: 1 },
        });
        expect(discord.messageDeletions(IDS.channel)).toEqual([REVIEW_POST, SCREENSHOT_POST]);
        expect(warn).toHaveBeenCalledWith(
            `[TaskService] Failed to DM user ${IDS.user} about ${submission.id}:`,
            expect.objectContaining({ code: RESTJSONErrorCodes.CannotSendMessagesToThisUser }),
        );
        expect(warn).toHaveBeenCalledWith(
            `[TaskService] Failed to archive submission ${submission.id}:`,
            expect.objectContaining({ code: RESTJSONErrorCodes.MissingPermissions }),
        );
    });

    test("still completes when the task's post has been deleted", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        await storeRunningEvent(factories, runningEvent);
        const submission = await storePendingSubmission(factories);
        // Registered first, so it answers before the route that serves the post
        discord.refuse("GET", `/channels/${IDS.channel}/messages/${EVENT_POST}`, DiscordError.unknownMessage);
        await acceptReviewEffects(discord, services);

        const confirm = await approve(discord, interact, submission, "silver");

        expect(discord.originalEdits(confirm).at(-1)).toMatchObject({
            content: "✅ Submission approved for **Silver tier** (1 roll) and archived.",
        });
        expect(await services.repos.taskRepo.getTaskEventById(EVENT)).toMatchObject({
            completionCounts: { bronze: 0, silver: 1, gold: 0 },
        });
        expect(error).toHaveBeenCalledWith(
            `[UpdateTaskCounter] Failed to update task embed for event ${EVENT}:`,
            expect.objectContaining({ code: RESTJSONErrorCodes.UnknownMessage }),
        );
    });

    test("still completes when no archive channel is configured", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await storeRunningEvent(factories, runningEvent);
        const submission = await storePendingSubmission(factories);
        await acceptReviewEffects(discord, services);
        await services.guilds.update(IDS.guild, { channels: { botArchive: "" } });

        const confirm = await approve(discord, interact, submission, "bronze");

        expect(discord.originalEdits(confirm).at(-1)).toMatchObject({
            content: "✅ Submission approved for **Bronze tier** (1 roll). It couldn't be archived; check the logs.",
        });
        expect(discord.messagesSentTo(ARCHIVE)).toEqual([]);
        expect(warn).toHaveBeenCalledWith(
            `[Channels] The botArchive channel (not set) of guild ${IDS.guild} isn't set or can't be reached.`,
        );
    });

    test("tells the admin when another admin already reviewed it", async ({ discord, interact, factories }) => {
        const submission = await storePendingSubmission(factories, { status: SubmissionStatus.Rejected });

        const confirm = await approve(discord, interact, submission, "gold");

        expect(discord.originalEdits(confirm).at(-1)).toMatchObject({
            content: "⚠️ This submission has already been reviewed (rejected). Another admin may have processed it.",
        });
    });

    test.for([
        { customId: "review-confirm||", reply: "Invalid confirmation payload. Please try again." },
        {
            customId: `review-confirm|approve|platinum|${taskSubmissionFactory.build().id}`,
            reply: "Invalid tier selected for approval.",
        },
    ])(
        "answers a confirmation button it can't read (%s) without reviewing",
        async ({ customId, reply }, { discord, interact, services, factories }) => {
            const submission = await storePendingSubmission(factories);

            const confirm = await interact(
                buttonInteraction(customId, apiMessage({ flags: MessageFlags.Ephemeral }), admin),
            );

            expect(discord.callbacks(confirm)).toEqual([
                {
                    type: InteractionResponseType.UpdateMessage,
                    data: expect.objectContaining({ content: reply, components: [] }),
                },
            ]);
            expect(await services.repos.taskRepo.getSubmissionById(submission.id)).toMatchObject({
                status: SubmissionStatus.Pending,
            });
        },
    );

    test("can be cancelled, leaving the submission pending", async ({ discord, interact, services, factories }) => {
        const submission = await storePendingSubmission(factories);
        const prompt = await interact(
            buttonInteraction(`approve_gold_${submission.id}`, apiMessage({ id: REVIEW_POST }), admin),
        );
        const cancelButton = `review-cancel|${submission.id}`;
        expect(discord.reply(prompt)?.components).toMatchObject([{ components: [{}, { custom_id: cancelButton }] }]);

        const cancel = await interact(
            buttonInteraction(cancelButton, apiMessage({ flags: MessageFlags.Ephemeral }), admin),
        );

        expect(discord.callbacks(cancel)).toEqual([
            {
                type: InteractionResponseType.UpdateMessage,
                data: expect.objectContaining({
                    content: "Review action cancelled. No changes were made.",
                    components: [],
                }),
            },
        ]);
        expect(await services.repos.taskRepo.getSubmissionById(submission.id)).toMatchObject({
            status: SubmissionStatus.Pending,
        });
    });

    describe("for Moni's Choice", () => {
        test.for([
            { held: "none of the week's regular tasks", completed: [] },
            {
                held: "every regular task of the week",
                completed: [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc],
            },
        ])("adds like any task while the member holds $held, and completes the approval", async ({ completed }, {
            discord,
            interact,
            services,
            factories,
        }) => {
            const { regularEvents, monisChoice } = await storeTaskWeek(factories, {
                startTime: DateTime.now().minus({ days: 1 }).toJSDate(),
                completedBy: Object.fromEntries(completed.map((category) => [category, [IDS.user]])),
                monisChoice: { messageId: EVENT_POST },
            });
            assert(monisChoice);
            await storePeriodic(factories, {
                period: { eventIds: [...regularEvents, monisChoice].map((event) => event.id) },
            });
            const submission = await storePendingSubmission(factories, {
                taskEventId: monisChoice.id,
                taskName: "Bank 100 Monis",
            });
            const { dm } = await acceptReviewEffects(discord, services);

            const confirm = await approve(discord, interact, submission, "gold");

            expect(discord.originalEdits(confirm).at(-1)).toMatchObject({
                content: "✅ Submission approved for **Gold tier** (1 roll) and archived.",
            });
            expect(await services.repos.taskRepo.getTaskEventById(monisChoice.id)).toMatchObject({
                completionCounts: { bronze: 0, silver: 0, gold: 1 },
                completedUserIds: [IDS.user],
            });
            expect(discord.messagesSentTo(dm)).toEqual([
                expect.objectContaining({
                    content: expect.stringMatching(
                        /^✅ Your submission for \*\*Bank 100 Monis\*\* has been approved for 🥇 \*\*Gold tier\*\*!/,
                    ),
                }),
            ]);
            expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ tasksCompletedGold: 1 });
            expect((await services.repos.taskLeaderboardRepo.getLeaderboard("lifetime"))?.points).toEqual({
                [IDS.user]: 6,
            });
            expect(await services.repos.taskLeaderboardRepo.getLeaderboard("periodic")).toMatchObject({
                points: { [IDS.user]: 6 },
                tierCounts: { [IDS.user]: { gold: 1 } },
            });
        });
    });
});

describe("rejecting a submission", () => {
    async function openRejectionForm(
        discord: DiscordHarness,
        interact: Interact,
        submission: TaskSubmission,
    ): Promise<string> {
        const prompt = await interact(
            buttonInteraction(`reject_${submission.id}`, apiMessage({ id: REVIEW_POST }), admin),
        );
        expect(discord.callbacks(prompt)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "Are you sure you want to reject this submission?",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
        const confirmButton = `review-confirm|reject||${submission.id}`;
        expect(discord.reply(prompt)?.components).toMatchObject([
            { components: [{ custom_id: confirmButton }, { custom_id: `review-cancel|${submission.id}` }] },
        ]);
        const confirm = await interact(
            buttonInteraction(confirmButton, apiMessage({ flags: MessageFlags.Ephemeral }), admin),
        );
        const modal = discord.modal(confirm);
        assert(modal);
        return modal.custom_id;
    }

    test("asks for a reason, then records it, tells the member and archives the submission", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeRunningEvent(factories, runningEvent);
        const submission = await storePendingSubmission(factories);
        const { dm } = await acceptReviewEffects(discord, services);

        const form = await openRejectionForm(discord, interact, submission);
        const submit = await interact(modalSubmitInteraction(form, { reason: "The keyword isn't visible" }, admin));

        expect(discord.callbacks(submit)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "❌ Submission rejected and archived." }),
        ]);
        expect(await services.repos.taskRepo.getSubmissionById(submission.id)).toMatchObject({
            status: SubmissionStatus.Rejected,
            rejectionReason: "The keyword isn't visible",
            reviewedBy: reviewer,
        });
        expect(discord.messagesSentTo(dm)).toEqual([
            expect.objectContaining({
                content: "❌ Your submission for **Kill Zulrah** was rejected.\n**Reason:** The keyword isn't visible",
            }),
        ]);
        expect(discord.messagesSentTo(ARCHIVE)[0]?.embeds?.[0]?.fields).toContainEqual({
            name: "Reason",
            value: "The keyword isn't visible",
        });
        expect(discord.messageDeletions(IDS.channel)).toEqual([REVIEW_POST, SCREENSHOT_POST]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                content: `❌ <@${reviewer}> rejected submission for **Kill Zulrah** by <@${IDS.user}>. Reason: The keyword isn't visible. Submission moved to archive channel.`,
            }),
        ]);
        expect(await services.repos.taskRepo.getTaskEventById(EVENT)).toMatchObject({
            completionCounts: { bronze: 0, silver: 0, gold: 0 },
            completedUserIds: [],
        });
    });

    test("leaves the tier the member already holds", async ({ discord, interact, services, factories }) => {
        await storeRunningEvent(factories, runningEvent);
        await storeApproval(services, factories, SubmissionStatus.Bronze);
        const submission = await storePendingSubmission(factories);
        await acceptReviewEffects(discord, services);

        const form = await openRejectionForm(discord, interact, submission);
        await interact(modalSubmitInteraction(form, { reason: "" }, admin));

        expect(await services.repos.taskRepo.getTaskEventById(EVENT)).toMatchObject({
            completionCounts: { bronze: 1, silver: 0, gold: 0 },
            completedUserIds: [IDS.user],
        });
        expect(await services.repos.userRepo.getUserById(IDS.user)).toMatchObject({ tasksCompletedBronze: 1 });
    });

    test("answers a form that names no submission once", async ({ discord, interact }) => {
        const submit = await interact(modalSubmitInteraction("reject_reason_", { reason: "" }, admin));

        expect(discord.callbacks(submit)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Submission ID missing from interaction." }),
        ]);
    });
});

describe("/mytask", () => {
    test("lists the member's submissions for the running task events, newest first", async ({
        discord,
        interact,
        factories,
    }) => {
        const pvm = await factories.taskEvent.running().create({
            id: "pvm-week",
            task: { id: "PVM001", category: TaskCategory.PvM },
        });
        const skilling = await factories.taskEvent.running().create({
            id: "skilling-week",
            task: { id: "SKL001", category: TaskCategory.Skilling },
        });
        await factories.taskSubmission.create({
            id: "older",
            userId: IDS.user,
            taskEventId: pvm.id,
            taskName: "Kill 50 Zulrah",
            status: SubmissionStatus.Gold,
            createdAt: DateTime.now().minus({ hours: 5 }).toJSDate(),
        });
        await factories.taskSubmission.create({
            id: "newer",
            userId: IDS.user,
            taskEventId: skilling.id,
            taskName: "Gain 100k Mining XP",
            status: SubmissionStatus.Pending,
            createdAt: DateTime.now().minus({ hours: 1 }).toJSDate(),
        });
        await factories.taskSubmission.create({
            id: "someone-elses",
            taskEventId: pvm.id,
            userId: SnowflakeUtil.generate().toString(),
        });

        const command = await interact(chatInputInteraction("mytask"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: [
                    "**Your Active Task Submissions:**",
                    "",
                    "• Gain 100k Mining XP: **Pending** ⏳",
                    "• Kill 50 Zulrah: **Approved for Gold** 🥇",
                ].join("\n"),
            }),
        ]);
    });

    test("says so when the member has nothing for the chosen category's running task", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.taskEvent.running().create({
            id: "pvm-week",
            task: { category: TaskCategory.PvM },
        });

        const command = await interact(
            chatInputInteraction("mytask", [
                { type: ApplicationCommandOptionType.String, name: "task_event", value: "current_pvm" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "You have no submissions for the current PvM task event." }),
        ]);
    });

    test("says so when no task event is running", async ({ discord, interact, factories }) => {
        await factories.taskEvent.ended().create();

        const command = await interact(chatInputInteraction("mytask"));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "There are no active task events at the moment." }),
        ]);
    });
});

describe("/testtaskapproval", () => {
    test("posts a test submission for the latest task event for review, with the chosen tier as a hint", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const event = await factories.taskEvent.create({
            id: "test-PVM001-1",
            task: { taskName: "Kill {amount} Vorkath" },
        });
        discord.acceptMessages(IDS.channel);

        const command = await interact(
            chatInputInteraction(
                "testtaskapproval",
                [{ type: ApplicationCommandOptionType.String, name: "tier", value: SubmissionStatus.Silver }],
                AS.botAdmin,
            ),
        );

        const [submission, ...others] = await services.repos.taskRepo.getSubmissionsByUser(IDS.user);
        assert(submission);
        expect(others).toEqual([]);
        expect(submission).toMatchObject({
            taskEventId: event.id,
            status: SubmissionStatus.Pending,
            notes: "[Test] Tier hint: silver",
            message: expect.any(String),
        });
        expect(discord.messagesSentTo(IDS.channel)).toHaveLength(1);
        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content: [
                    `✅ Test submission posted to <#${IDS.channel}>.`,
                    "**Task:** Kill {amount} Vorkath",
                    `**User:** <@${IDS.user}>`,
                    "**Tier hint:** silver",
                    `**Submission ID:** \`${submission.id}\``,
                ].join("\n"),
            }),
        ]);
    });

    test("says so when the given task event doesn't exist", async ({ discord, interact }) => {
        const command = await interact(
            chatInputInteraction(
                "testtaskapproval",
                [{ type: ApplicationCommandOptionType.String, name: "taskid", value: "PVM001" }],
                AS.botAdmin,
            ),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({
                content:
                    "❌ Task event `PVM001` not found. This expects an event ID (e.g. `test-PVM001-123456`), not a task ID. Run `/testtask` first, then use the ID from the embed footer.",
            }),
        ]);
    });

    test("says so when there are no task events", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("testtaskapproval", [], AS.botAdmin));

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "❌ No task events found. Run `/testtask` first to create one." }),
        ]);
    });
});

describe("TaskRepository submission drafts", () => {
    test("keeps one draft per member, the latest replacing the one before", async ({ services }) => {
        await services.repos.taskRepo.saveSubmissionDraft(submissionDraftFactory.build({ taskEventId: "week-1" }));
        await services.repos.taskRepo.saveSubmissionDraft(
            submissionDraftFactory.build({ taskEventId: "week-2", createdAt: new Date("2026-01-06T01:00:00.000Z") }),
        );

        expect(await services.repos.taskRepo.getSubmissionDraft(IDS.user)).toEqual(
            submissionDraftFactory.build({ taskEventId: "week-2", createdAt: new Date("2026-01-06T01:00:00.000Z") }),
        );
        expect(await services.repos.taskRepo.getSubmissionDraft(otherUser)).toBeNull();
    });
});
