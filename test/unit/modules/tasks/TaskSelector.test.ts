import { describe, expect, test, vi } from "vitest";
import { uniformFloat64 } from "pure-rand/distribution/uniformFloat64";
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import { pickWeightedRandom, selectTasksForCategory } from "../../../../src/modules/tasks/TaskSelector.js";
import { Skill, TaskCategory } from "../../../../src/models/Task.js";
import { taskFactory } from "../../../factories.js";

function seedRandom(seed: number): void {
    const rng = xoroshiro128plus(seed);
    vi.spyOn(Math, "random").mockImplementation(() => uniformFloat64(rng));
}

describe("pickWeightedRandom", () => {
    test("favours tasks in proportion to their weight", () => {
        seedRandom(7);
        const tasks = [taskFactory.build({ id: "common", weight: 75 }), taskFactory.build({ id: "rare", weight: 25 })];

        const picks = Array.from({ length: 4000 }, () => pickWeightedRandom(tasks, 1)[0]?.id);

        expect(picks.filter((id) => id === "common").length / picks.length).toBeCloseTo(0.75, 1);
    });

    test("never picks a task weighted zero while another task is left", () => {
        vi.spyOn(Math, "random").mockReturnValue(0);
        const tasks = [
            taskFactory.build({ id: "voted-out", weight: 0 }),
            taskFactory.build({ id: "normal", weight: 50 }),
        ];

        expect(pickWeightedRandom(tasks, 1).map((task) => task.id)).toEqual(["normal"]);
        expect(pickWeightedRandom(tasks, 2).map((task) => task.id)).toEqual(["normal", "voted-out"]);
    });

    test("picks each task at most once", () => {
        seedRandom(3);
        const tasks = Array.from({ length: 5 }, (_, index) => taskFactory.build({ id: `PVM00${index}` }));

        const picked = pickWeightedRandom(tasks, 3).map((task) => task.id);

        expect(new Set(picked).size).toBe(3);
    });

    test("picks nothing from no tasks", () => {
        expect(pickWeightedRandom([], 3)).toEqual([]);
    });
});

describe("selectTasksForCategory", () => {
    const skilling = [
        taskFactory.build({ id: "WC1", category: TaskCategory.Skilling, skill: Skill.Woodcutting }),
        taskFactory.build({ id: "WC2", category: TaskCategory.Skilling, skill: Skill.Woodcutting }),
        taskFactory.build({ id: "FSH", category: TaskCategory.Skilling, skill: Skill.Fishing }),
        taskFactory.build({ id: "MIN", category: TaskCategory.Skilling, skill: Skill.Mining }),
        taskFactory.build({ id: "COO", category: TaskCategory.Skilling, skill: Skill.Cooking }),
    ];

    test("offers three PvM tasks from the PvM tasks only", () => {
        seedRandom(11);
        const tasks = [
            ...skilling,
            ...Array.from({ length: 5 }, (_, index) =>
                taskFactory.build({ id: `PVM00${index}`, category: TaskCategory.PvM }),
            ),
        ];

        const selected = selectTasksForCategory(TaskCategory.PvM, tasks);

        expect(selected).toHaveLength(3);
        expect(selected.every((task) => task.category === TaskCategory.PvM)).toBe(true);
    });

    test("offers skilling tasks from three different skills", () => {
        seedRandom(5);

        const skills = selectTasksForCategory(TaskCategory.Skilling, skilling).map((task) => task.skill);

        expect(skills).toHaveLength(3);
        expect(new Set(skills).size).toBe(3);
    });

    test("offers every skill equally often", () => {
        seedRandom(42);
        const offered = new Map<string | undefined, number>();
        const polls = 4000;

        for (let poll = 0; poll < polls; poll++) {
            for (const task of selectTasksForCategory(TaskCategory.Skilling, skilling)) {
                offered.set(task.skill, (offered.get(task.skill) ?? 0) + 1);
            }
        }

        for (const skill of [Skill.Woodcutting, Skill.Fishing, Skill.Mining, Skill.Cooking]) {
            expect((offered.get(skill) ?? 0) / polls).toBeCloseTo(0.75, 1);
        }
    });

    test("offers nothing for a category without tasks, saying so", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(selectTasksForCategory(TaskCategory.MinigameMisc, skilling)).toEqual([]);
        expect(warn).toHaveBeenCalledWith(`[TaskSelector] No tasks found for category ${TaskCategory.MinigameMisc}`);
    });
});
