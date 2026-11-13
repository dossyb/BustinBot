import { LabelBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import type { Task, TaskCategory } from "../../models/Task.js";

const AMOUNTS = /^\s*(\d+)(?:\s*[,/]\s*|\s+)(\d+)(?:\s*[,/]\s*|\s+)(\d+)\s*$/;
const TASK_ID = /^[A-Za-z]+\d+$/;

export const AMOUNTS_ERROR = "The amounts must be three whole numbers for bronze, silver and gold, e.g. 5, 10, 20.";

export function taskFormFields(task?: Task): LabelBuilder[] {
    const taskName = new TextInputBuilder().setCustomId("taskName").setStyle(TextInputStyle.Short);
    const shortName = new TextInputBuilder().setCustomId("shortName").setStyle(TextInputStyle.Short);
    const amounts = new TextInputBuilder().setCustomId("amounts").setStyle(TextInputStyle.Short);
    if (task) {
        taskName.setValue(task.taskName);
        if (task.shortName) shortName.setValue(task.shortName);
        amounts.setValue(`${task.amtBronze}, ${task.amtSilver}, ${task.amtGold}`);
    }

    return [
        new LabelBuilder()
            .setLabel("Task Name")
            .setDescription("What to do, without the amount, e.g. Obtain Barrows pieces")
            .setTextInputComponent(taskName),
        new LabelBuilder()
            .setLabel("Short Name")
            .setDescription("Shown on poll buttons and in /listtasks")
            .setTextInputComponent(shortName),
        new LabelBuilder()
            .setLabel("Bronze, Silver, Gold Amounts")
            .setDescription("Split by a comma, slash or space, e.g. 5, 10, 20")
            .setTextInputComponent(amounts),
    ];
}

export function parseAmounts(input: string): Pick<Task, "amtBronze" | "amtSilver" | "amtGold"> | null {
    const match = AMOUNTS.exec(input);
    if (!match?.[1] || !match[2] || !match[3]) return null;
    return { amtBronze: Number(match[1]), amtSilver: Number(match[2]), amtGold: Number(match[3]) };
}

export function nextTaskId(tasks: Task[], category: TaskCategory): string | null {
    const [last] = tasks
        .filter((task) => task.category === category && TASK_ID.test(task.id))
        .map((task) => task.id)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return last?.replace(/\d+$/, (digits) => String(Number(digits) + 1).padStart(digits.length, "0")) ?? null;
}
