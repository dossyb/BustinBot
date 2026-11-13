import { describe, expect, test } from "vitest";
import { parseTasksCsv } from "../../../../src/modules/tasks/TaskImport.js";
import { TaskCategory, TaskType } from "../../../../src/models/Task.js";

const CSV = [
    "ID,Task Name,Category,Type,Skill,Bronze Amount,Silver Amount,Gold Amount,Weight,Short Name,Wilderness Required?,XP per Action,Min XP for Bronze,Min XP for Silver,Min XP for Gold",
    'SKL001,Gain {amount} Sailing XP,Skilling,XP,Sailing,"150,000","400,000","800,000",60,Sailing,FALSE,35,"10,000","20,000","40,000"',
    "PVM001,Kill {amount} Zulrah,PvM,KC,,10,25,50,,Zulrah,TRUE,,,,",
    ",Row without an ID,PvM,KC,,1,2,3,,,FALSE,,,,",
    "PVM002,Misspelt category,Pvm,KC,,1,2,3,,,FALSE,,,,",
    "PVM003,Unknown type,PvM,Kills,,1,2,3,,,FALSE,,,,",
    "",
].join("\n");

describe("parseTasksCsv", () => {
    test("maps normalised headers onto tasks and keeps skilling-only fields for skilling tasks", () => {
        const [skilling, pvm] = parseTasksCsv(CSV);

        expect(skilling).toEqual({
            id: "SKL001",
            taskName: "Gain {amount} Sailing XP",
            category: TaskCategory.Skilling,
            type: TaskType.XP,
            skill: "Sailing",
            amtBronze: 150000,
            amtSilver: 400000,
            amtGold: 800000,
            weight: 60,
            shortName: "Sailing",
            wildernessReq: false,
            xpPerAction: 35,
            minXPBronze: 10000,
            minXPSilver: 20000,
            minXPGold: 40000,
        });

        expect(pvm).toEqual({
            id: "PVM001",
            taskName: "Kill {amount} Zulrah",
            category: TaskCategory.PvM,
            type: TaskType.KC,
            amtBronze: 10,
            amtSilver: 25,
            amtGold: 50,
            weight: 50,
            shortName: "Zulrah",
            wildernessReq: true,
        });
    });

    test("skips rows without an ID or with a category or type it doesn't know, and never emits undefined fields", () => {
        const tasks = parseTasksCsv(CSV);

        expect(tasks.map((task) => task.id)).toEqual(["SKL001", "PVM001"]);
        for (const task of tasks) {
            expect(Object.values(task)).not.toContain(undefined);
        }
    });
});
