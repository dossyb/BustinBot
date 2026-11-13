import { parse } from "csv-parse/sync";
import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo.js";
import { Skill, TaskCategory, TaskType, type Task } from "../../models/Task.js";
import { DEFAULT_TASK_WEIGHT } from "./TaskSelector.js";

type CsvRow = Record<string, string>;

export interface TaskImportResult {
    newCount: number;
    skipped: number;
    total: number;
}

function toNumber(value: string | undefined): number | undefined {
    if (value === undefined || value === "") return undefined;
    const parsed = Number(value.replace(/[^\d.\-]/g, "").trim());
    return isNaN(parsed) ? undefined : parsed;
}

function normalizeKey(key: string): string {
    return key
        .toLowerCase()
        .replace(/\u00A0/g, " ")
        .trim()
        .replace(/\s+/g, "_"); // turn "Min XP for Bronze" → "min_xp_for_bronze"
}

function rowToTask(row: CsvRow): Task | null {
    const id = (row["id"] ?? row["i_d"] ?? "").trim();
    const category = Object.values(TaskCategory).find((value) => value === row["category"]);
    const type = Object.values(TaskType).find((value) => value === row["type"]);
    const skill = Object.values(Skill).find((value) => value === row["skill"]);
    if (!id || !category || !type) return null;
    const shortName = row["short_name"];
    const isSkilling = category === "Skilling" || !!skill;

    const xpPerAction = toNumber(row["xp_per_action"]);
    const minXPBronze = toNumber(row["min_xp_for_bronze"]);
    const minXPSilver = toNumber(row["min_xp_for_silver"]);
    const minXPGold = toNumber(row["min_xp_for_gold"]);

    return {
        id,
        taskName: row["task_name"] ?? "",
        category,
        type,
        ...(skill && { skill }),
        amtBronze: toNumber(row["bronze_amount"]) ?? 0,
        amtSilver: toNumber(row["silver_amount"]) ?? 0,
        amtGold: toNumber(row["gold_amount"]) ?? 0,
        weight: toNumber(row["weight"]) ?? DEFAULT_TASK_WEIGHT,
        ...(shortName && { shortName }),
        wildernessReq: row["wilderness_required?"] === "TRUE" || row["wildernessreq"] === "TRUE",
        ...(isSkilling && xpPerAction !== undefined && { xpPerAction }),
        ...(isSkilling && minXPBronze !== undefined && { minXPBronze }),
        ...(isSkilling && minXPSilver !== undefined && { minXPSilver }),
        ...(isSkilling && minXPGold !== undefined && { minXPGold }),
    };
}

export function parseTasksCsv(csv: string): Task[] {
    const rows = parse<CsvRow>(csv, {
        columns: (header: string[]) => header.map(normalizeKey),
        skip_empty_lines: true,
    });

    return rows.map(rowToTask).filter((task): task is Task => task !== null);
}

export async function importTasks(
    repo: Pick<ITaskRepository, "getAllTasks" | "seedTasks">,
    tasks: Task[],
): Promise<TaskImportResult> {
    const existingIds = new Set((await repo.getAllTasks()).map((task) => task.id));
    const newTasks = tasks.filter((task) => !existingIds.has(task.id));

    if (newTasks.length > 0) {
        await repo.seedTasks(newTasks);
    }

    return { newCount: newTasks.length, skipped: tasks.length - newTasks.length, total: tasks.length };
}
