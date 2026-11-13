import { random, randomInt, shuffle } from "es-toolkit";
import type { Task } from "../../models/Task.js";
import { TaskCategory } from "../../models/Task.js";

export const DEFAULT_TASK_WEIGHT = 50;

export function pickWeightedRandom(tasks: Task[], count: number): Task[] {
    if (!tasks.length) return [];

    const selected: Task[] = [];
    const pool = [...tasks];

    for (let i = 0; i < count && pool.length > 0; i++) {
        const weights = pool.map((task) => Math.max(task.weight ?? DEFAULT_TASK_WEIGHT, 0));
        const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

        let chosenIndex: number;
        if (totalWeight <= 0) {
            chosenIndex = randomInt(pool.length);
        } else {
            const roll = random(totalWeight);
            let runningTotal = 0;
            chosenIndex = pool.length - 1;
            for (const [j, weight] of weights.entries()) {
                runningTotal += weight;
                if (roll < runningTotal) {
                    chosenIndex = j;
                    break;
                }
            }
        }

        selected.push(...pool.splice(chosenIndex, 1));
    }

    console.log(
        `[TaskSelector] Selected tasks: ${selected
            .map(t => `${t.taskName} (weight: ${t.weight ?? DEFAULT_TASK_WEIGHT})`)
            .join(", ")}`
    );

    return selected;
}

export function selectTasksForCategory(category: TaskCategory, allTasks: Task[]): Task[] {
    const taskData = allTasks.filter(t => t.category === category);
    if (taskData.length === 0) {
        console.warn(`[TaskSelector] No tasks found for category ${category}`);
        return [];
    }

    // ───────────── Skilling ─────────────
    if (category === TaskCategory.Skilling) {
        // Group by skill
        const skillGroups: Record<string, Task[]> = {};
        for (const task of taskData) {
            const skill = task.skill ?? "Unknown";
            if (!skillGroups[skill]) skillGroups[skill] = [];
            skillGroups[skill].push(task);
        }

        // Randomly choose up to 3 unique skills
        const chosenSkills = shuffle(Object.keys(skillGroups)).slice(0, 3);

        const selected: Task[] = [];
        for (const skill of chosenSkills) {
            const tasks = skillGroups[skill];
            if (!tasks || tasks.length === 0) continue;
            const [randomTask] = pickWeightedRandom(tasks, 1);
            if (randomTask) selected.push(randomTask);
        }

        console.log(`[TaskSelector] Rolled skills for Skilling poll: ${chosenSkills.join(", ")}`);
        return selected;
    }

    // ───────────── PvM / Minigame / Leagues ─────────────
    const selected = pickWeightedRandom(taskData, 3);
    return selected;
}