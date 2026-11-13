import type { Client, Guild } from "discord.js";
import type { TaskMilestoneRole } from "../../models/Guild.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import type { UserStats } from "../../models/UserStats.js";

export const DEFAULT_TASK_MILESTONES: TaskMilestoneRole[] = [
    { id: "task-participant", label: "Task Participant", roleId: "", requiredSubmissions: 5, enabled: true },
    { id: "task-enthusiast", label: "Task Enthusiast", roleId: "", requiredSubmissions: 25, enabled: true },
    { id: "task-expert", label: "Task Expert", roleId: "", requiredSubmissions: 50, enabled: true },
    { id: "task-master", label: "Task Master", roleId: "", requiredSubmissions: 100, enabled: true },
];

export function normaliseMilestoneId(label: string): string {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

export function resolveMilestones(configured?: TaskMilestoneRole[]): TaskMilestoneRole[] {
    if (configured && configured.length > 0) return configured;
    return DEFAULT_TASK_MILESTONES;
}

export function getTotalTaskCompletions(stats: Pick<UserStats, "tasksCompletedBronze" | "tasksCompletedSilver" | "tasksCompletedGold" | "legacyTasksCompleted">): number {
    return (
        (stats.tasksCompletedBronze ?? 0) +
        (stats.tasksCompletedSilver ?? 0) +
        (stats.tasksCompletedGold ?? 0) +
        (stats.legacyTasksCompleted ?? 0)
    );
}

export function getHighestMilestone(
    milestones: TaskMilestoneRole[],
    totalCompletions: number
): TaskMilestoneRole | null {
    const eligible = milestones
        .filter((milestone) => milestone.enabled && totalCompletions >= milestone.requiredSubmissions)
        .sort((a, b) => a.requiredSubmissions - b.requiredSubmissions);

    return eligible.length > 0 ? eligible[eligible.length - 1] ?? null : null;
}

function resolveMilestoneRoleId(guild: Guild, milestone: TaskMilestoneRole): string | null {
    if (milestone.roleId) return milestone.roleId;
    const role = guild.roles.cache.find((candidate) => candidate.name === milestone.label);
    return role?.id ?? null;
}

export async function applyTaskMilestoneRoles(
    client: Client,
    services: ServiceContainer,
    userId: string
): Promise<void> {
    const userRepo = services.repos.userRepo;

    const stats = await userRepo.getUserById(userId);
    if (!stats) return;

    const totalApproved = getTotalTaskCompletions(stats);

    const guildId = services.guildId;
    const guildConfig = guildId ? await services.guilds.get(guildId) : null;
    if (!guildId || !guildConfig) return;

    const milestones = resolveMilestones(guildConfig.taskSettings?.milestoneRoles).slice().sort(
        (a, b) => a.requiredSubmissions - b.requiredSubmissions
    );

    const highestMilestone = getHighestMilestone(milestones, totalApproved);

    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);

    for (const milestone of milestones) {
        const roleId = resolveMilestoneRoleId(guild, milestone);
        if (!roleId) continue;

        const shouldHave = highestMilestone?.id === milestone.id;
        const hasRole = member.roles.cache.has(roleId);

        if (shouldHave && !hasRole) {
            try {
                await member.roles.add(roleId);
            } catch (err) {
                console.warn(`[TaskMilestones] Failed to grant milestone role ${milestone.label} to ${userId}:`, err);
                continue;
            }
            try {
                await member.send(`You have earned the **${milestone.label}** role for completing ${milestone.requiredSubmissions} tasks!`);
            } catch (err) {
                console.warn(`[TaskMilestones] Granted ${milestone.label} to ${userId} but couldn't DM them:`, err);
            }
        } else if (!shouldHave && hasRole) {
            try {
                await member.roles.remove(roleId);
            } catch (err) {
                console.warn(`[TaskMilestones] Failed to remove milestone role ${milestone.label} from ${userId}:`, err);
            }
        }
    }
}
