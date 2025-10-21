import type { Task } from "models/Task";
import { TaskCategory } from "models/Task";

export function pickWeightedRandom(tasks: Task[], count: number): Task[] {
    if (!tasks.length) return [];

    const selected: Task[] = [];
    const pool = [...tasks];

    for (let i = 0; i < count && pool.length > 0; i++) {
        const totalWeight = pool.reduce((sum, t) => sum + (t.weight ?? 50), 0);
        let roll = Math.random() * totalWeight;
        let chosenIndex = 0;

        for (let j = 0; j < pool.length; j++) {
            const task = pool[j];
            if (!task) continue;

            roll -= task.weight ?? 50;
            if (roll <= 0) {
                chosenIndex = j;
                break;
            }
        }

        const chosen = pool[chosenIndex];
        if (chosen) {
            selected.push(chosen);
            pool.splice(chosenIndex, 1);
        }
    }

    console.log(
        `[TaskSelector] Selected tasks: ${selected
            .map(t => `${t.taskName} (weight: ${t.weight ?? 50})`)
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
        const allSkills = Object.keys(skillGroups);
        const shuffledSkills = allSkills.sort(() => Math.random() - 0.5);
        const chosenSkills = shuffledSkills.slice(0, Math.min(3, shuffledSkills.length));

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