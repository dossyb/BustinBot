import { EmbedBuilder, type InteractionEditReplyOptions } from "discord.js";
import table from "text-table";
import { truncate } from "../../utils/TextUtils.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { listPage, pageButtons } from "../../utils/Pagination.js";
import { TaskCategory, type Task } from "../../models/Task.js";

const TASKS_PER_PAGE = 25;
export const CATEGORY_ALL = "all";

export type CategoryFilter = TaskCategory | typeof CATEGORY_ALL;
const CATEGORY_FILTERS: CategoryFilter[] = [CATEGORY_ALL, ...Object.values(TaskCategory)];

export function toCategoryFilter(value: string | null | undefined): CategoryFilter {
    return CATEGORY_FILTERS.find((filter) => filter === value) ?? CATEGORY_ALL;
}

export const TASK_LIST_BUTTON = "listtasks|";

function formatTaskTable(tasks: Task[]): string {
    const rows = tasks.map((task) => [
        truncate(task.id, 14),
        truncate(task.shortName?.trim() || task.taskName, 40),
        String(task.amtBronze),
        String(task.amtSilver),
        String(task.amtGold),
    ]);
    return [
        "```",
        table([["ID", "Task Name", "B", "S", "G"], ...rows], { align: ["l", "l", "r", "r", "r"], hsep: "  " }),
        "```",
    ].join("\n");
}

function categoryLabel(category: CategoryFilter): string {
    return category === CATEGORY_ALL ? "All Categories" : category;
}

export async function buildTaskListPage(
    services: ServiceContainer,
    category: CategoryFilter,
    requestedPage: number,
): Promise<InteractionEditReplyOptions> {
    const tasks = (await services.tasks.getAllTasks())
        .filter((task) => category === CATEGORY_ALL || task.category === category)
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" }));

    if (!tasks.length) {
        const content =
            category === CATEGORY_ALL
                ? "No tasks were found in the database."
                : `No tasks were found for **${category}**.`;
        return { content, embeds: [], components: [] };
    }

    const { page, lastPage, items } = listPage(tasks, TASKS_PER_PAGE, requestedPage);
    const embed = new EmbedBuilder()
        .setColor(0xa60000)
        .setTitle(`📋 Task List - ${categoryLabel(category)}`)
        .setDescription(formatTaskTable(items))
        .setFooter({ text: `Page ${page + 1}/${lastPage + 1} • ${tasks.length} task${tasks.length === 1 ? "" : "s"}` });
    const components = lastPage === 0 ? [] : [pageButtons(`${TASK_LIST_BUTTON}${category}|`, page, lastPage)];
    return { content: "", embeds: [embed], components };
}

export function taskListButtonCategory(customId: string): CategoryFilter {
    return toCategoryFilter(customId.split("|")[1]);
}
