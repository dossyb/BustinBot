import { describe, expect, test } from "vitest";
import { nextTaskId, parseAmounts } from "../../../../src/modules/tasks/TaskForm.js";
import { TaskCategory } from "../../../../src/models/Task.js";
import { taskFactory } from "../../../factories.js";

describe("parseAmounts", () => {
    test("reads bronze, silver and gold split by commas, slashes or spaces, with spaces around them ignored", () => {
        const amounts = { amtBronze: 5, amtSilver: 10, amtGold: 150000 };

        expect(parseAmounts("5,10,150000")).toEqual(amounts);
        expect(parseAmounts("5, 10, 150000")).toEqual(amounts);
        expect(parseAmounts("5/10/150000")).toEqual(amounts);
        expect(parseAmounts("5 / 10 /150000")).toEqual(amounts);
        expect(parseAmounts("5 10 150000")).toEqual(amounts);
        expect(parseAmounts(" 5 ,  10/150000 ")).toEqual(amounts);
    });

    test("refuses anything but three whole numbers", () => {
        expect(parseAmounts("5, 10")).toBeNull();
        expect(parseAmounts("5, 10, 20, 40")).toBeNull();
        expect(parseAmounts("5, 10, 1.5")).toBeNull();
        expect(parseAmounts("5, lots, 20")).toBeNull();
        expect(parseAmounts("5,, 10, 20")).toBeNull();
        expect(parseAmounts("5, 10, 150,000")).toBeNull();
    });
});

describe("nextTaskId", () => {
    test("follows the category's highest numbered ID, keeping its prefix and width", () => {
        const tasks = [
            taskFactory.build({ id: "PVM009", category: TaskCategory.PvM }),
            taskFactory.build({ id: "PVM063", category: TaskCategory.PvM }),
            taskFactory.build({ id: "PVM010", category: TaskCategory.PvM }),
            taskFactory.build({ id: "PVM-old", category: TaskCategory.PvM }),
            taskFactory.build({ id: "SKL241", category: TaskCategory.Skilling }),
        ];

        expect(nextTaskId(tasks, TaskCategory.PvM)).toBe("PVM064");
        expect(nextTaskId(tasks, TaskCategory.Skilling)).toBe("SKL242");
    });

    test("orders IDs by their number, not as text, and lets the number outgrow its width", () => {
        expect(
            nextTaskId(
                [
                    taskFactory.build({ id: "LEA10", category: TaskCategory.Leagues }),
                    taskFactory.build({ id: "LEA9", category: TaskCategory.Leagues }),
                ],
                TaskCategory.Leagues,
            ),
        ).toBe("LEA11");
        expect(nextTaskId([taskFactory.build({ id: "PVM999", category: TaskCategory.PvM })], TaskCategory.PvM)).toBe(
            "PVM1000",
        );
    });

    test("follows the prefix that sorts last when a category's IDs use more than one", () => {
        const tasks = [
            taskFactory.build({ id: "PVM063", category: TaskCategory.PvM }),
            taskFactory.build({ id: "BOSS100", category: TaskCategory.PvM }),
        ];

        expect(nextTaskId(tasks, TaskCategory.PvM)).toBe("PVM064");
    });

    test("has nothing to follow for a category without numbered IDs", () => {
        expect(
            nextTaskId([taskFactory.build({ id: "PVM001", category: TaskCategory.PvM })], TaskCategory.Leagues),
        ).toBeNull();
    });
});
