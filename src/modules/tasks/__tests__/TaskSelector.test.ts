import { describe, it, expect, vi } from 'vitest';

import { pickWeightedRandom, selectTasksForCategory } from '../TaskSelector.js';
import { Skill, TaskCategory, TaskType } from '../../../models/Task.js';
import type { Task } from '../../../models/Task.js';

let counter = 0;
const baseTask = (overrides: Partial<Task>): Task => {
    const task: Task = {
        id: overrides.id ?? `task-${counter++}`,
        taskName: overrides.taskName ?? 'Task',
        category: overrides.category ?? TaskCategory.PvM,
        type: overrides.type ?? TaskType.KC,
        amounts: overrides.amounts ?? [],
        amtBronze: overrides.amtBronze ?? 1,
        amtSilver: overrides.amtSilver ?? 2,
        amtGold: overrides.amtGold ?? 3,
    };

    for (const key of Object.keys(overrides) as (keyof Task)[]) {
        const value = overrides[key];
        if (value !== undefined) {
            (task as any)[key] = value;
        }
    }

    return task;
};

describe('TaskSelector weighted selection', () => {
    it('selects tasks without duplication and honours weights', () => {
        const tasks = [
            baseTask({ id: 'heavy', taskName: 'Heavy', weight: 100 }),
            baseTask({ id: 'light', taskName: 'Light', weight: 1 }),
        ];

        const randomVals = [0.0, 0.99];
        const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => randomVals.shift() ?? 0);

        const result = pickWeightedRandom(tasks, 2);

        expect(result).toHaveLength(2);
        expect(new Set(result.map((t) => t.id)).size).toBe(2);
        expect(result[0]?.id).toBe('heavy');
        expect(result[1]?.id).toBe('light');

        randomSpy.mockRestore();
    });

    it('returns empty array if no tasks', () => {
        expect(pickWeightedRandom([], 3)).toEqual([]);
    });
});

describe('selectTasksForCategory', () => {
    it('returns up to three PvM tasks', () => {
        const tasks = Array.from({ length: 5 }, (_, i) =>
            baseTask({ id: `pvm-${i}`, taskName: `PvM ${i}`, category: TaskCategory.PvM, weight: 50 + i })
        );

        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

        const selected = selectTasksForCategory(TaskCategory.PvM, tasks);
        expect(selected.length).toBeLessThanOrEqual(3);
        selected.forEach((task) => expect(task.category).toBe(TaskCategory.PvM));

        randomSpy.mockRestore();
    });

    it('selects unique skills for Skilling category', () => {
        const tasks: Task[] = [
            baseTask({ id: 'sk1a', category: TaskCategory.Skilling, taskName: 'Woodcutting 1', skill: Skill.Woodcutting }),
            baseTask({ id: 'sk1b', category: TaskCategory.Skilling, taskName: 'Woodcutting 2', skill: Skill.Woodcutting }),
            baseTask({ id: 'sk2', category: TaskCategory.Skilling, taskName: 'Fishing', skill: Skill.Fishing }),
            baseTask({ id: 'sk3', category: TaskCategory.Skilling, taskName: 'Mining', skill: Skill.Mining }),
            baseTask({ id: 'sk4', category: TaskCategory.Skilling, taskName: 'Cooking', skill: Skill.Cooking }),
        ];

        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.3);

        const selected = selectTasksForCategory(TaskCategory.Skilling, tasks);

        expect(selected.length).toBeLessThanOrEqual(3);

        const skills = selected.map((task) => task.skill);
        expect(new Set(skills).size).toBe(skills.length);

        randomSpy.mockRestore();
    });

    it('returns empty array if no tasks for category', () => {
        const result = selectTasksForCategory(TaskCategory.MinigameMisc, []);
        expect(result).toEqual([]);
    });
});
