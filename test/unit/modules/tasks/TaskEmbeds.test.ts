import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildTaskEventEmbed } from "../../../../src/modules/tasks/TaskEmbeds.js";
import { TaskCategory } from "../../../../src/models/Task.js";
import { taskEventFactory } from "../../../factories.js";

describe("buildTaskEventEmbed", () => {
    test.for([
        { category: TaskCategory.PvM, icon: "task_pvm.png" },
        { category: TaskCategory.Skilling, icon: "task_skilling.png" },
        { category: TaskCategory.MinigameMisc, icon: "task_minigame.png" },
        { category: TaskCategory.Leagues, icon: "task_minigame.png" },
        { category: TaskCategory.MonisChoice, icon: "task_monischoice.png" },
    ])("attaches the $category icon", ({ category, icon }) => {
        const { files } = buildTaskEventEmbed(taskEventFactory.build({ task: { category } }));

        expect(files).toEqual([{ attachment: path.resolve("assets/icons", icon), name: "category_icon.png" }]);
    });

    test.for([
        { task: "with a description", description: "Show your bank.", opening: "**Bank 100 Monis**\nShow your bank.\n\n" },
        { task: "without a description", description: undefined, opening: "**Bank 100 Monis**\n\n" },
    ])("starts with the task's name, then its description, for a task $task", ({ description, opening }) => {
        const { embeds } = buildTaskEventEmbed(
            taskEventFactory.build({ task: { taskName: "Bank 100 Monis", ...(description && { description }) } }),
        );

        expect(embeds[0]?.toJSON().description).toMatch(new RegExp(`^${RegExp.escape(opening)}Amounts required`));
    });
});
