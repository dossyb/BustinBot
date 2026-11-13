import {
    ApplicationCommandOptionType,
    ChannelType,
    ComponentType,
    InteractionContextType,
    InteractionResponseType,
    MessageFlags,
    RESTJSONErrorCodes,
    TextInputStyle,
    type APIApplicationCommandAutocompleteDMInteraction,
    type APIApplicationCommandInteractionDataOption,
} from "discord-api-types/v10";
import { describe, expect, vi, storePeriodic, storeRunningEvent, storeTaskWeek, test } from "../fixtures.js";
import {
    apiMessage,
    apiUser,
    autocompleteInteraction,
    buttonInteraction,
    chatInputInteraction,
    AS,
    apiAttachment,
    IDS,
    modalSubmitInteraction,
    PRIVATE_DEFERRAL,
    DiscordError,
} from "../discord/payloads.js";
import { Skill, TaskCategory, TaskType } from "../../src/models/Task.js";
import { SnowflakeUtil } from "discord.js";
import { DateTime } from "luxon";
import { taskFactory } from "../factories.js";
import { resolvePeriodicProgress } from "../../src/modules/tasks/TaskLeaderboards.js";
import { TaskInstructions } from "../../src/modules/tasks/TaskInstructions.js";
import assert from "node:assert";
import type { DiscordHarness } from "../discord/harness.js";
import type { ServiceContainer } from "../../src/core/services/ServiceContainer.js";

const CSV = [
    "ID,Task Name,Category,Type,Skill,Bronze Amount,Silver Amount,Gold Amount,Weight,Short Name,Wilderness Required?",
    "PVM001,Kill {amount} Zulrah,PvM,KC,,10,25,50,,Zulrah,TRUE",
    "PVM002,Kill {amount} Vorkath,PvM,KC,,5,10,20,,Vorkath,FALSE",
].join("\n");

const eventMessage = SnowflakeUtil.generate().toString();
const pollMessage = SnowflakeUtil.generate().toString();
const completer = SnowflakeUtil.generate().toString();
const voter = SnowflakeUtil.generate().toString();
const form = {
    taskName: "Kill {amount} Vorkath",
    shortName: "Vorkath",
    type: [TaskType.Drop],
    amounts: "5, 10/150000",
};

const runningEvent = { id: "PVM001-week", messageId: eventMessage };

describe("/listtasks", () => {
    test("pages through a category's tasks with buttons that keep working", async ({
        discord,
        interact,
        factories,
    }) => {
        for (let number = 1; number <= 26; number++) {
            await factories.task.create({
                id: `MIN${String(number).padStart(3, "0")}`,
                category: TaskCategory.MinigameMisc,
            });
        }
        await factories.task.create({ id: "PVM001", category: TaskCategory.PvM });

        const command = await interact(
            chatInputInteraction("listtasks", [
                { type: ApplicationCommandOptionType.String, name: "category", value: TaskCategory.MinigameMisc },
            ]),
        );
        const [firstPage] = discord.originalEdits(command);
        const next = await interact(
            buttonInteraction("listtasks|Minigame/Misc|next|1", apiMessage({ flags: MessageFlags.Ephemeral })),
        );

        expect(firstPage?.embeds?.[0]).toMatchObject({
            title: "📋 Task List - Minigame/Misc",
            footer: { text: "Page 1/2 • 26 tasks" },
        });
        expect(firstPage?.embeds?.[0]?.description).toContain("MIN025");
        expect(firstPage?.embeds?.[0]?.description).not.toContain("MIN026");
        expect(firstPage?.components).toMatchObject([
            {
                components: [
                    { custom_id: "listtasks|Minigame/Misc|start|0" },
                    { custom_id: "listtasks|Minigame/Misc|prev|-1" },
                    { custom_id: "listtasks|Minigame/Misc|next|1" },
                    { custom_id: "listtasks|Minigame/Misc|end|1" },
                ],
            },
        ]);
        expect(discord.callbacks(next)).toEqual([{ type: InteractionResponseType.DeferredMessageUpdate }]);
        const [secondPage] = discord.originalEdits(next);
        expect(secondPage?.embeds?.[0]).toMatchObject({ footer: { text: "Page 2/2 • 26 tasks" } });
        expect(secondPage?.embeds?.[0]?.description).toContain("MIN026");
        expect(secondPage?.embeds?.[0]?.description).not.toContain("MIN025");
        expect(secondPage?.components).toMatchObject([
            {
                components: expect.arrayContaining([
                    expect.objectContaining({ custom_id: "listtasks|Minigame/Misc|end|1", disabled: true }),
                ]),
            },
        ]);
    });

    test("shows every category on one page without buttons when the tasks fit, in aligned columns", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.task.create({
            id: "PVM001",
            category: TaskCategory.PvM,
            shortName: "Zulrah",
            amtBronze: 10,
            amtSilver: 25,
            amtGold: 150,
        });
        await factories.task.create({
            id: "SKL001",
            category: TaskCategory.Skilling,
            taskName: "Chop {amount} logs at the Woodcutting Guild in Hosidius",
            amtBronze: 1000000,
            amtSilver: 2,
            amtGold: 3,
        });

        const command = await interact(chatInputInteraction("listtasks"));

        const [page] = discord.originalEdits(command);
        expect(page).toMatchObject({
            embeds: [
                {
                    title: "📋 Task List - All Categories",
                    description: [
                        "```",
                        "ID      Task Name                                       B   S    G",
                        "PVM001  Zulrah                                         10  25  150",
                        "SKL001  Chop {amount} logs at the Woodcutting...  1000000   2    3",
                        "```",
                    ].join("\n"),
                    footer: { text: "Page 1/1 • 2 tasks" },
                },
            ],
            components: [],
        });
    });

    test("says so when a category has no tasks", async ({ discord, interact, factories }) => {
        await factories.task.create({ id: "PVM001", category: TaskCategory.PvM });

        const command = await interact(
            chatInputInteraction("listtasks", [
                { type: ApplicationCommandOptionType.String, name: "category", value: TaskCategory.Leagues },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No tasks were found for **Leagues**." }),
        ]);
    });

    test("shows every category for a page button whose category it doesn't know", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.task.create({ id: "PVM001", category: TaskCategory.PvM });
        await factories.task.create({ id: "SKL001", category: TaskCategory.Skilling });

        const press = await interact(
            buttonInteraction("listtasks|Raids|start|0", apiMessage({ flags: MessageFlags.Ephemeral })),
        );

        expect(discord.originalEdits(press)).toEqual([
            expect.objectContaining({
                embeds: [expect.objectContaining({ title: "📋 Task List - All Categories" })],
            }),
        ]);
    });
});

describe("/viewtask", () => {
    test("shows the task found by its id, with its tier amounts", async ({ discord, interact, factories }) => {
        const task = await factories.task.create({
            id: "PVM007",
            taskName: "Kill {amount} Vorkath",
            category: TaskCategory.PvM,
            amtBronze: 5,
            amtSilver: 10,
            amtGold: 20,
        });

        const command = await interact(
            chatInputInteraction("viewtask", [
                { type: ApplicationCommandOptionType.String, name: "search", value: task.id },
            ]),
        );

        const [reply] = discord.originalEdits(command);
        expect(reply?.embeds?.[0]).toMatchObject({ title: "PvM Task", footer: { text: task.id } });
        expect(reply?.embeds?.[0]?.description).toContain("**Kill {amount} Vorkath**");
        expect(reply?.embeds?.[0]?.description).toContain("🥉 **5** 🥈 **10** 🥇 **20**");
    });

    test("finds a task by a misspelt name", async ({ discord, interact, factories }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah" });
        const vorkath = await factories.task.create({ id: "PVM002", taskName: "Kill {amount} Vorkath" });

        const command = await interact(
            chatInputInteraction("viewtask", [
                { type: ApplicationCommandOptionType.String, name: "search", value: "vorkth" },
            ]),
        );

        expect(discord.originalEdits(command)[0]?.embeds?.[0]?.footer?.text).toBe(vorkath.id);
    });

    test("says so when nothing matches", async ({ discord, interact, factories }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah" });

        const command = await interact(
            chatInputInteraction("viewtask", [
                { type: ApplicationCommandOptionType.String, name: "search", value: "Tempoross" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No task found matching `Tempoross`." }),
        ]);
    });

    test("says so when no tasks are stored", async ({ discord, interact }) => {
        const command = await interact(
            chatInputInteraction("viewtask", [
                { type: ApplicationCommandOptionType.String, name: "search", value: "PVM001" },
            ]),
        );

        expect(discord.originalEdits(command)).toEqual([
            expect.objectContaining({ content: "No tasks were found in the database." }),
        ]);
    });
});

describe("/importtasks", () => {
    test("adds the tasks in the uploaded file that aren't stored yet, leaving stored ones untouched", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const tasks = services.repos.taskRepo;
        await factories.task.create({ id: "PVM001", taskName: "Already stored" });
        const attachment = apiAttachment({ filename: "tasks.csv", size: CSV.length, content_type: "text/csv" });
        discord.serveAttachment(attachment, Buffer.from(CSV));

        const interaction = await interact(
            chatInputInteraction(
                "importtasks",
                [{ type: ApplicationCommandOptionType.Attachment, name: "file", value: attachment.id }],
                AS.botAdmin,
                { attachments: { [attachment.id]: attachment } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({
                content: "✅ Import complete.\n• 1 new tasks added\n• 1 skipped (existing)\n• 2 total in file.",
            }),
        ]);
        expect(await tasks.getTaskById("PVM001")).toMatchObject({ taskName: "Already stored" });
        expect(await tasks.getTaskById("PVM002")).toMatchObject({ taskName: "Kill {amount} Vorkath", amtGold: 20 });
    });

    test("refuses a file that isn't a CSV", async ({ discord, interact }) => {
        const attachment = apiAttachment({ filename: "tasks.xlsx", size: CSV.length, content_type: "text/csv" });

        const interaction = await interact(
            chatInputInteraction(
                "importtasks",
                [{ type: ApplicationCommandOptionType.Attachment, name: "file", value: attachment.id }],
                AS.botAdmin,
                { attachments: { [attachment.id]: attachment } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Please upload a valid CSV file." }),
        ]);
    });

    test("reports a failed download", async ({ discord, interact, http }) => {
        const attachment = apiAttachment({ filename: "tasks.csv", size: CSV.length, content_type: "text/csv" });
        http.get("https://cdn.discordapp.com")
            .intercept({ path: new URL(attachment.url).pathname, method: "GET" })
            .reply(404, "Not Found");
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        const interaction = await interact(
            chatInputInteraction(
                "importtasks",
                [{ type: ApplicationCommandOptionType.Attachment, name: "file", value: attachment.id }],
                AS.botAdmin,
                { attachments: { [attachment.id]: attachment } },
            ),
        );

        expect(discord.originalEdits(interaction)).toEqual([
            expect.objectContaining({ content: "Import failed. Check logs for details." }),
        ]);
        expect(error).toHaveBeenCalledWith(new Error("Failed to download tasks.csv: HTTP 404"));
    });
});

describe("the update task form", () => {
    test("saves the task and redraws its running event and open poll, keeping their completions and votes", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const tasks = services.repos.taskRepo;
        await storeRunningEvent(factories, {
            ...runningEvent,
            completionCounts: { bronze: 1, silver: 0, gold: 0 },
            completedUserIds: [completer],
        });
        await factories.taskPoll.open().create({
            messageId: pollMessage,
            category: TaskCategory.PvM,
            options: [taskFactory.build({ id: "PVM001" }), taskFactory.build({ id: "PVM002" })],
            votes: { [voter]: "PVM001" },
        });
        for (const id of [eventMessage, pollMessage]) discord.serveMessage(apiMessage({ id }));
        discord.acceptMessageEdits(IDS.channel);

        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM001", form));

        expect(discord.callbacks(submit)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **PVM001** updated successfully." }),
        ]);
        expect(await tasks.getTaskById("PVM001")).toMatchObject({
            taskName: "Kill {amount} Vorkath",
            shortName: "Vorkath",
            type: TaskType.Drop,
            amtBronze: 5,
            amtSilver: 10,
            amtGold: 150000,
        });
        expect(await tasks.getTaskEventById("PVM001-week")).toMatchObject({
            task: { taskName: "Kill {amount} Vorkath" },
            amounts: { bronze: 5, silver: 10, gold: 150000 },
            completionCounts: { bronze: 1, silver: 0, gold: 0 },
            completedUserIds: [completer],
        });
        expect(await tasks.getTaskPollById(pollMessage)).toMatchObject({
            votes: { [voter]: "PVM001" },
            options: [{ id: "PVM001", taskName: "Kill {amount} Vorkath" }, { id: "PVM002" }],
        });
        expect(discord.messageEdits(IDS.channel, eventMessage)).toHaveLength(1);
        expect(discord.messageEdits(IDS.channel, pollMessage)).toHaveLength(1);
    });

    test("leaves an event that hasn't started yet alone", async ({ discord, interact, services, factories }) => {
        await storeRunningEvent(factories, {
            ...runningEvent,
            startTime: DateTime.now().plus({ days: 1 }).toJSDate(),
            endTime: DateTime.now().plus({ days: 8 }).toJSDate(),
        });

        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM001", form));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **PVM001** updated successfully." }),
        ]);
        expect(await services.repos.taskRepo.getTaskEventById("PVM001-week")).toMatchObject({
            task: { taskName: "Kill {amount} Zulrah" },
        });
    });

    test("changes nothing when the amounts aren't three whole numbers", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeRunningEvent(factories, runningEvent);

        const submit = await interact(
            modalSubmitInteraction("update_task_modal_PVM001", { ...form, amounts: "5, lots, 1.5" }),
        );

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content:
                    "The amounts must be three whole numbers for bronze, silver and gold, e.g. 5, 10, 20. Nothing was changed.",
            }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({
            amtGold: taskFactory.build().amtGold,
        });
    });

    test("answers when the task no longer exists", async ({ discord, interact }) => {
        const submit = await interact(modalSubmitInteraction("update_task_modal_PVM404", form));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Could not find task with ID **PVM404**." }),
        ]);
    });
});

describe("/updatetask", () => {
    test("opens the edit form pre-filled from the stored task as its first response", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.task.create({
            id: "PVM001",
            taskName: "Kill {amount} Zulrah",
            shortName: "Zulrah",
            amtBronze: 10,
            amtSilver: 25,
            amtGold: 50,
        });

        const interaction = await interact(
            chatInputInteraction(
                "updatetask",
                [{ type: ApplicationCommandOptionType.String, name: "id", value: "PVM001" }],
                AS.taskAdmin,
            ),
        );

        expect(discord.callbacks(interaction)).toHaveLength(1);
        const modal = discord.modal(interaction);
        expect(modal?.custom_id).toBe("update_task_modal_PVM001");
        const values = modal?.components
            .flatMap((label) => ("component" in label ? [label.component] : []))
            .map((input) => [
                "custom_id" in input ? input.custom_id : "",
                input.type === ComponentType.StringSelect
                    ? input.options.filter((option) => option.default).map((option) => option.value)
                    : "value" in input
                      ? input.value
                      : "",
            ]);
        expect(Object.fromEntries(values ?? [])).toEqual({
            taskName: "Kill {amount} Zulrah",
            shortName: "Zulrah",
            type: [TaskType.KC],
            amounts: "10, 25, 50",
        });
    });

    test("replies privately when the task does not exist", async ({ discord, interact }) => {
        const interaction = await interact(
            chatInputInteraction(
                "updatetask",
                [{ type: ApplicationCommandOptionType.String, name: "id", value: "NOPE" }],
                AS.taskAdmin,
            ),
        );

        expect(discord.callbacks(interaction)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "No task found with ID **NOPE**.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });

    test("suggests tasks matching what the member types, each filling in its ID", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah", shortName: "Zulrah" });
        await factories.task.create({ id: "PVM002", taskName: "Kill {amount} Vorkath", shortName: "Vorkath" });

        const typing = await interact(
            autocompleteInteraction("updatetask", [
                { type: ApplicationCommandOptionType.String, name: "id", value: "vorkth", focused: true },
            ]),
        );

        expect(discord.callbacks(typing)).toEqual([
            {
                type: InteractionResponseType.ApplicationCommandAutocompleteResult,
                data: { choices: [{ name: "PVM002 · Kill {amount} Vorkath", value: "PVM002" }] },
            },
        ]);
    });

    test("suggests the first tasks before anything is typed", async ({ discord, interact, factories }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah" });
        await factories.task.create({ id: "PVM002", taskName: "Kill {amount} Vorkath" });

        const typing = await interact(
            autocompleteInteraction("updatetask", [
                { type: ApplicationCommandOptionType.String, name: "id", value: " ", focused: true },
            ]),
        );

        expect(discord.callbacks(typing)).toEqual([
            {
                type: InteractionResponseType.ApplicationCommandAutocompleteResult,
                data: {
                    choices: [
                        { name: "PVM001 · Kill {amount} Zulrah", value: "PVM001" },
                        { name: "PVM002 · Kill {amount} Vorkath", value: "PVM002" },
                    ],
                },
            },
        ]);
    });

    test("suggests nothing in DMs, where the command doesn't run", async ({ discord, interact, factories }) => {
        await factories.task.create({ id: "PVM001" });
        const {
            guild_id: _guildId,
            member: _member,
            ...typing
        } = autocompleteInteraction("updatetask", [
            { type: ApplicationCommandOptionType.String, name: "id", value: "zulrah", focused: true },
        ]);
        const inDm: APIApplicationCommandAutocompleteDMInteraction = {
            ...typing,
            context: InteractionContextType.BotDM,
            user: apiUser(),
            channel: { id: IDS.dm, type: ChannelType.DM },
            channel_id: IDS.dm,
        };

        const interaction = await interact(inDm);

        expect(discord.callbacks(interaction)).toEqual([
            { type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices: [] } },
        ]);
    });
});

describe("/newtask", () => {
    const options = (category: TaskCategory, type: TaskType): APIApplicationCommandInteractionDataOption[] => [
        { type: ApplicationCommandOptionType.String, name: "category", value: category },
        { type: ApplicationCommandOptionType.String, name: "type", value: type },
    ];
    const form = { taskName: "Kill Vorkath", shortName: "Vorkath", amounts: "5 / 10 / 1000", id: "" };

    test("opens the form as its first response, offering one past the category's highest ID", async ({
        discord,
        interact,
        factories,
    }) => {
        await factories.task.create({ id: "PVM063", category: TaskCategory.PvM });

        const command = await interact(
            chatInputInteraction(
                "newtask",
                [
                    ...options(TaskCategory.PvM, TaskType.KC),
                    { type: ApplicationCommandOptionType.String, name: "skill", value: Skill.Slayer },
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.callbacks(command)).toHaveLength(1);
        const modal = discord.modal(command);
        expect(modal).toMatchObject({ custom_id: "new_task_modal|PvM|KC|Slayer", title: "New PvM task" });
        expect(modal?.components).toMatchObject([
            { component: { custom_id: "taskName" } },
            { component: { custom_id: "shortName" } },
            { component: { custom_id: "amounts" } },
            { label: "ID", description: "Leave blank to use PVM064", component: { custom_id: "id", required: false } },
        ]);
    });

    test("replies privately when Discord sends a category the bot no longer has", async ({ discord, interact }) => {
        const command = await interact(
            chatInputInteraction(
                "newtask",
                [
                    { type: ApplicationCommandOptionType.String, name: "category", value: "Raids" },
                    { type: ApplicationCommandOptionType.String, name: "type", value: TaskType.KC },
                ],
                AS.taskAdmin,
            ),
        );

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "Could not read the category. Please run /newtask again.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });

    test.for([
        { role: "task admins", as: AS.taskAdmin },
        { role: "bot admins", as: AS.botAdmin },
    ])("opens the form for $role", async ({ as }, { discord, interact }) => {
        const command = await interact(chatInputInteraction("newtask", options(TaskCategory.PvM, TaskType.KC), as));

        expect(discord.modal(command)?.custom_id).toBe("new_task_modal|PvM|KC|");
    });

    test("is refused to members who are neither task admins nor bot admins", async ({ discord, interact }) => {
        const command = await interact(chatInputInteraction("newtask", options(TaskCategory.PvM, TaskType.KC)));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "You don't have permission to use this command.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });

    test("asks for an ID when the category has no tasks to number from", async ({ discord, interact }) => {
        const command = await interact(
            chatInputInteraction("newtask", options(TaskCategory.Leagues, TaskType.Other), AS.taskAdmin),
        );

        expect(discord.modal(command)?.custom_id).toBe("new_task_modal|Leagues|Other|");
        expect(discord.modal(command)?.components[3]).toMatchObject({
            description: "No Leagues tasks to number from yet, so give one",
            component: { custom_id: "id", required: true },
        });
    });

    test("saves the task under the next ID, so it is found straight away", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await factories.task.create({ id: "PVM063", category: TaskCategory.PvM });
        await services.tasks.searchTasks("vorkath", 25);

        const submit = await interact(modalSubmitInteraction("new_task_modal|PvM|KC|Slayer", form));

        expect(discord.callbacks(submit)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **PVM064** created successfully." }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM064")).toEqual({
            id: "PVM064",
            taskName: "Kill Vorkath",
            shortName: "Vorkath",
            category: TaskCategory.PvM,
            type: TaskType.KC,
            skill: Skill.Slayer,
            amtBronze: 5,
            amtSilver: 10,
            amtGold: 1000,
            weight: 50,
        });
        expect((await services.tasks.searchTasks("vorkath", 25)).map((task) => task.id)).toEqual(["PVM064"]);
    });

    test("saves the task under a typed ID", async ({ discord, interact, services }) => {
        const submit = await interact(
            modalSubmitInteraction("new_task_modal|Leagues|Other|", {
                ...form,
                taskName: "  Kill Vorkath ",
                shortName: " Vorkath  ",
                id: " LEA001 ",
            }),
        );

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **LEA001** created successfully." }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("LEA001")).toMatchObject({
            category: TaskCategory.Leagues,
            taskName: "Kill Vorkath",
            shortName: "Vorkath",
        });
        expect(await services.repos.taskRepo.getTaskById("LEA001")).not.toHaveProperty("skill");
    });

    test("leaves a stored task alone when its ID is given", async ({ discord, interact, services, factories }) => {
        await factories.task.create({ id: "PVM001", taskName: "Kill {amount} Zulrah" });

        const submit = await interact(modalSubmitInteraction("new_task_modal|PvM|KC|", { ...form, id: "PVM001" }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **PVM001** already exists. Nothing was saved." }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM001")).toMatchObject({ taskName: "Kill {amount} Zulrah" });
    });

    test("saves nothing when the amounts aren't three whole numbers", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await factories.task.create({ id: "PVM063", category: TaskCategory.PvM });

        const submit = await interact(
            modalSubmitInteraction("new_task_modal|PvM|KC|", { ...form, amounts: "5, lots, 1.5" }),
        );

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content:
                    "The amounts must be three whole numbers for bronze, silver and gold, e.g. 5, 10, 20. Nothing was saved.",
            }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM064")).toBeNull();
    });

    test("saves nothing when the ID is left blank for a category with no tasks", async ({
        discord,
        interact,
        services,
    }) => {
        const submit = await interact(modalSubmitInteraction("new_task_modal|Leagues|Other|", form));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content: "There are no Leagues tasks to number from yet, so an ID is needed. Nothing was saved.",
            }),
        ]);
        expect(await services.repos.taskRepo.getAllTasks()).toEqual([]);
    });

    test("treats an ID of only spaces as left blank", async ({ discord, interact, services, factories }) => {
        await factories.task.create({ id: "PVM063", category: TaskCategory.PvM });

        const submit = await interact(modalSubmitInteraction("new_task_modal|PvM|KC|", { ...form, id: "   " }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **PVM064** created successfully." }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("PVM064")).toMatchObject({ taskName: "Kill Vorkath" });
    });

    test.for([
        { field: "category", customId: "new_task_modal|Raids|KC|" },
        { field: "type", customId: "new_task_modal|PvM|Kills|" },
    ])("saves nothing when the form's $field can't be read", async ({ customId }, { discord, interact, services }) => {
        const submit = await interact(modalSubmitInteraction(customId, { ...form, id: "PVM001" }));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Could not read the category or type. Please run /newtask again." }),
        ]);
        expect(await services.repos.taskRepo.getAllTasks()).toEqual([]);
    });

    test("saves the task without a skill when the form's skill isn't one it knows", async ({
        discord,
        interact,
        services,
    }) => {
        const submit = await interact(
            modalSubmitInteraction("new_task_modal|Skilling|XP|Raids", { ...form, id: "SKL001" }),
        );

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "Task **SKL001** created successfully." }),
        ]);
        expect(await services.repos.taskRepo.getTaskById("SKL001")).not.toHaveProperty("skill");
    });
});

describe("/monischoice", () => {
    const thisWeek = () => DateTime.now().minus({ days: 1 }).toJSDate();

    function formValues(modal: ReturnType<DiscordHarness["modal"]>) {
        return Object.fromEntries(
            (modal?.components ?? [])
                .flatMap((label) => ("component" in label ? [label.component] : []))
                .map((input) => ["custom_id" in input ? input.custom_id : "", "value" in input ? input.value : undefined]),
        );
    }

    test.for([
        { role: "task admins", as: AS.taskAdmin },
        { role: "bot admins", as: AS.botAdmin },
    ])("opens an empty form for $role as its first response when the week has no Moni's Choice", async (
        { as },
        { discord, interact, factories },
    ) => {
        await storeTaskWeek(factories, { startTime: thisWeek(), monisChoice: false });

        const command = await interact(chatInputInteraction("monischoice", [], as));

        expect(discord.callbacks(command)).toHaveLength(1);
        const modal = discord.modal(command);
        expect(modal).toMatchObject({ custom_id: "monis_choice_modal", title: "New Moni's Choice" });
        expect(modal?.components).toMatchObject([
            { label: "Task Name", component: { custom_id: "taskName", style: TextInputStyle.Short } },
            { label: "Description", component: { custom_id: "description", style: TextInputStyle.Paragraph } },
            { label: "Bronze Amount", component: { custom_id: "bronze", style: TextInputStyle.Short } },
            { label: "Silver Amount", component: { custom_id: "silver", style: TextInputStyle.Short } },
            { label: "Gold Amount", component: { custom_id: "gold", style: TextInputStyle.Short } },
        ]);
        expect(formValues(modal)).toEqual({
            taskName: undefined,
            description: undefined,
            bronze: undefined,
            silver: undefined,
            gold: undefined,
        });
    });

    test("fills the form in from the week's Moni's Choice", async ({ discord, interact, factories }) => {
        await storeTaskWeek(factories, {
            startTime: thisWeek(),
            monisChoice: { task: { taskName: "Bank 100 Monis", description: "Show your bank.", amtBronze: 1, amtSilver: 5, amtGold: 100 } },
        });

        const command = await interact(chatInputInteraction("monischoice", [], AS.taskAdmin));

        expect(discord.modal(command)).toMatchObject({ custom_id: "monis_choice_modal", title: "Update Moni's Choice" });
        expect(formValues(discord.modal(command))).toEqual({
            taskName: "Bank 100 Monis",
            description: "Show your bank.",
            bronze: "1",
            silver: "5",
            gold: "100",
        });
    });

    test("is refused to members who are neither task admins nor bot admins", async ({ discord, interact, factories }) => {
        await storeTaskWeek(factories, { startTime: thisWeek(), monisChoice: false });

        const command = await interact(chatInputInteraction("monischoice"));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "You don't have permission to use this command.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });

    test.for([
        { when: "no task has ever run", weeksAgo: undefined },
        { when: "only last week's tasks exist", weeksAgo: 1 },
    ])("replies privately without a form when $when", async ({ weeksAgo }, { discord, interact, factories }) => {
        if (weeksAgo) {
            await storeTaskWeek(factories, {
                startTime: DateTime.now().minus({ weeks: weeksAgo, days: 1 }).toJSDate(),
                monisChoice: false,
            });
        }

        const command = await interact(chatInputInteraction("monischoice", [], AS.taskAdmin));

        expect(discord.callbacks(command)).toEqual([
            {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: expect.objectContaining({
                    content: "There are no weekly tasks running for Moni's Choice to end with.",
                    flags: MessageFlags.Ephemeral,
                }),
            },
        ]);
    });
});

describe("the Moni's Choice form", () => {
    const thisWeek = () => DateTime.now().minus({ days: 1 }).toJSDate();
    const form = {
        taskName: "Bank 100 Monis",
        description: "Screenshot your bank with the keyword visible.",
        bronze: "1",
        silver: "50",
        gold: "100",
    };

    async function storedMonisChoice(services: ServiceContainer) {
        const now = new Date();
        const running = await services.repos.taskRepo.getTaskEventsBetween(
            now,
            DateTime.fromJSDate(now).plus({ weeks: 1 }).toJSDate(),
        );
        return running.filter((event) => event.category === TaskCategory.MonisChoice);
    }

    test("posts Moni's Choice into the running week, ending with its tasks, with no feedback buttons", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const { regularEvents } = await storeTaskWeek(factories, { startTime: thisWeek(), monisChoice: false });
        discord.acceptMessages(IDS.channel);

        const submit = await interact(modalSubmitInteraction("monis_choice_modal", form, AS.taskAdmin));

        expect(discord.callbacks(submit)).toEqual([PRIVATE_DEFERRAL]);
        expect(discord.originalEdits(submit)).toEqual([expect.objectContaining({ content: "Moni's Choice posted." })]);
        const [first, , last] = regularEvents;
        assert(first && last);
        const [event, ...others] = await storedMonisChoice(services);
        assert(event);
        expect(others).toEqual([]);
        expect(event).toEqual({
            id: expect.stringMatching(/^MONIS-\d{8}-[0-9a-f]{8}$/),
            task: {
                id: "MONIS",
                taskName: "Bank 100 Monis",
                description: "Screenshot your bank with the keyword visible.",
                category: TaskCategory.MonisChoice,
                type: TaskType.Other,
                amtBronze: 1,
                amtSilver: 50,
                amtGold: 100,
            },
            category: TaskCategory.MonisChoice,
            keyword: first.keyword,
            startTime: first.startTime,
            endTime: last.endTime,
            amounts: { bronze: 1, silver: 50, gold: 100 },
            completionCounts: { bronze: 0, silver: 0, gold: 0 },
            completedUserIds: [],
            channelId: IDS.channel,
            messageId: expect.any(String),
            createdAt: expect.any(Date),
        });
        expect(discord.messagesSentTo(IDS.channel)).toEqual([
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: "Moni's Choice Task",
                        description: [
                            "**Bank 100 Monis**\nScreenshot your bank with the keyword visible.",
                            "Amounts required for each tier of completion:\n\n🥉 **1**\u2003🥈 **50**\u2003🥇 **100**",
                            "**Completions:** 🥉0 🥈0 🥇0",
                            `**Submission Instructions:**\n${TaskInstructions[TaskType.Other]}`,
                            "Click **Submit Screenshot(s)** below to make your submission.",
                        ].join("\n\n"),
                        footer: { text: `Ends ${last.endTime.toUTCString()} • ${event.id}` },
                        thumbnail: { url: "attachment://category_icon.png" },
                    }),
                ],
                components: [
                    {
                        type: ComponentType.ActionRow,
                        components: [expect.objectContaining({ custom_id: `task-submit-${event.id}` })],
                    },
                ],
                files: ["category_icon.png"],
            }),
        ]);
    });

    test("ends with the week's Leagues task too when Leagues is on", async ({ discord, interact, services, factories }) => {
        const { regularEvents } = await storeTaskWeek(factories, {
            startTime: thisWeek(),
            categories: [TaskCategory.PvM, TaskCategory.Skilling, TaskCategory.MinigameMisc, TaskCategory.Leagues],
            monisChoice: false,
        });
        discord.acceptMessages(IDS.channel);

        await interact(modalSubmitInteraction("monis_choice_modal", form, AS.taskAdmin));

        expect((await storedMonisChoice(services))[0]?.endTime).toEqual(regularEvents.at(-1)?.endTime);
    });

    test("joins the running week in the periodic leaderboard without adding a week to it", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const { regularEvents } = await storeTaskWeek(factories, { startTime: thisWeek(), monisChoice: false });
        const eventIds = regularEvents.map((event) => event.id);
        await storePeriodic(factories, { period: { eventIds } });
        discord.acceptMessages(IDS.channel);

        await interact(modalSubmitInteraction("monis_choice_modal", form, AS.taskAdmin));

        const [event] = await storedMonisChoice(services);
        const leaderboard = await services.repos.taskLeaderboardRepo.getLeaderboard("periodic");
        assert(event && leaderboard?.period);
        expect(leaderboard.period.eventIds).toEqual([...eventIds, event.id]);
        expect(await resolvePeriodicProgress(services, leaderboard.period)).toMatchObject({ started: 1 });
    });

    test("trims spaces around the name, description and amounts", async ({ discord, interact, services, factories }) => {
        await storeTaskWeek(factories, { startTime: thisWeek(), monisChoice: false });
        discord.acceptMessages(IDS.channel);

        await interact(
            modalSubmitInteraction(
                "monis_choice_modal",
                { taskName: "  Bank 100 Monis ", description: " Show your bank.  ", bronze: " 1", silver: "50 ", gold: " 100 " },
                AS.taskAdmin,
            ),
        );

        expect((await storedMonisChoice(services))[0]?.task).toMatchObject({
            taskName: "Bank 100 Monis",
            description: "Show your bank.",
            amtBronze: 1,
            amtSilver: 50,
            amtGold: 100,
        });
    });

    test.for([
        { field: "bronze", value: "1.5" },
        { field: "silver", value: "lots" },
        { field: "gold", value: "-100" },
        { field: "bronze", value: "" },
        { field: "silver", value: "   " },
        { field: "gold", value: "1,000" },
    ])("saves and posts nothing when the $field amount is '$value'", async ({ field, value }, {
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeTaskWeek(factories, { startTime: thisWeek(), monisChoice: false });

        const submit = await interact(modalSubmitInteraction("monis_choice_modal", { ...form, [field]: value }, AS.taskAdmin));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content: "The bronze, silver and gold amounts must be whole numbers. Nothing was saved.",
            }),
        ]);
        expect(await storedMonisChoice(services)).toEqual([]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
    });

    test.for([
        { field: "taskName", value: "   " },
        { field: "description", value: "  " },
    ])("saves and posts nothing when the $field is empty", async ({ field, value }, {
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeTaskWeek(factories, { startTime: thisWeek(), monisChoice: false });

        const submit = await interact(modalSubmitInteraction("monis_choice_modal", { ...form, [field]: value }, AS.taskAdmin));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({ content: "The task name and description can't be empty. Nothing was saved." }),
        ]);
        expect(await storedMonisChoice(services)).toEqual([]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
    });

    test("updates the week's Moni's Choice and its post instead of posting another, keeping its completions", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const { monisChoice } = await storeTaskWeek(factories, {
            startTime: thisWeek(),
            monisChoice: {
                messageId: eventMessage,
                completionCounts: { bronze: 1, silver: 0, gold: 0 },
                completedUserIds: [completer],
            },
        });
        assert(monisChoice);
        discord.serveMessage(apiMessage({ id: eventMessage }));
        discord.acceptMessageEdits(IDS.channel);

        const submit = await interact(
            modalSubmitInteraction("monis_choice_modal", { ...form, taskName: "Bank 200 Monis", gold: "200" }, AS.taskAdmin),
        );

        expect(discord.originalEdits(submit)).toEqual([expect.objectContaining({ content: "Moni's Choice updated." })]);
        expect(await storedMonisChoice(services)).toEqual([
            {
                ...monisChoice,
                task: {
                    id: "MONIS",
                    taskName: "Bank 200 Monis",
                    description: "Screenshot your bank with the keyword visible.",
                    category: TaskCategory.MonisChoice,
                    type: TaskType.Other,
                    amtBronze: 1,
                    amtSilver: 50,
                    amtGold: 200,
                },
                amounts: { bronze: 1, silver: 50, gold: 200 },
            },
        ]);
        const [edit, ...moreEdits] = discord.messageEdits(IDS.channel, eventMessage);
        expect(moreEdits).toEqual([]);
        expect(edit?.embeds?.[0]?.description).toContain(
            "**Bank 200 Monis**\nScreenshot your bank with the keyword visible.\n\n",
        );
        expect(edit?.embeds?.[0]?.description).toContain("**Completions:** 🥉1 🥈0 🥇0");
        expect(edit?.components).toEqual([
            {
                type: ComponentType.ActionRow,
                components: [expect.objectContaining({ custom_id: `task-submit-${monisChoice.id}` })],
            },
        ]);
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
    });

    test("still saves the update when the Moni's Choice post has been deleted", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const { monisChoice } = await storeTaskWeek(factories, {
            startTime: thisWeek(),
            monisChoice: { messageId: eventMessage },
        });
        assert(monisChoice);
        discord.refuse("GET", `/channels/${IDS.channel}/messages/${eventMessage}`, DiscordError.unknownMessage);

        const submit = await interact(
            modalSubmitInteraction("monis_choice_modal", { ...form, taskName: "Bank 200 Monis" }, AS.taskAdmin),
        );

        expect(discord.originalEdits(submit)).toEqual([expect.objectContaining({ content: "Moni's Choice updated." })]);
        expect((await services.repos.taskRepo.getTaskEventById(monisChoice.id))?.task.taskName).toBe("Bank 200 Monis");
        expect(error).toHaveBeenCalledWith(
            "[HandleMonisChoiceModal] Failed to update the Moni's Choice post:",
            expect.objectContaining({ code: RESTJSONErrorCodes.UnknownMessage }),
        );
    });

    test("saves nothing when the week's tasks have ended by the time the form is sent", async ({
        discord,
        interact,
        services,
        factories,
    }) => {
        await storeTaskWeek(factories, { startTime: DateTime.now().minus({ weeks: 1, days: 1 }).toJSDate(), monisChoice: false });

        const submit = await interact(modalSubmitInteraction("monis_choice_modal", form, AS.taskAdmin));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content: "There are no weekly tasks running for Moni's Choice to end with. Nothing was saved.",
            }),
        ]);
        expect(await services.repos.taskRepo.getTaskEventsBetween(new Date(0), DateTime.now().plus({ weeks: 2 }).toJSDate())).not.toContainEqual(
            expect.objectContaining({ category: TaskCategory.MonisChoice }),
        );
        expect(discord.messagesSentTo(IDS.channel)).toEqual([]);
    });

    test("saves nothing when no task channel is set up", async ({ discord, interact, services, factories }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        await storeTaskWeek(factories, { startTime: thisWeek(), monisChoice: false });
        await services.guilds.update(IDS.guild, { channels: { taskChannel: "" } });

        const submit = await interact(modalSubmitInteraction("monis_choice_modal", form, AS.taskAdmin));

        expect(discord.originalEdits(submit)).toEqual([
            expect.objectContaining({
                content: "The task channel isn't set up, so Moni's Choice can't be posted. Nothing was saved.",
            }),
        ]);
        expect(await storedMonisChoice(services)).toEqual([]);
        expect(warn).toHaveBeenCalledWith(
            `[Channels] The taskChannel channel (not set) of guild ${IDS.guild} isn't set or can't be reached.`,
        );
    });
});
