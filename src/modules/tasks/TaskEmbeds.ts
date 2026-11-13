import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, time, TimestampStyles } from "discord.js";
import path from "path";
import type { TaskEvent } from "../../models/TaskEvent.js";
import type { Task } from "../../models/Task.js";
import { TaskCategory } from "../../models/Task.js";
import { SubmissionStatus, type TaskSubmission } from "../../models/TaskSubmission.js";
import { TaskInstructions } from "./TaskInstructions.js";

const assetIconDir = path.join(import.meta.dirname, "../../../assets/icons");
const categoryIcons: Record<TaskCategory, string> = {
    [TaskCategory.PvM]: path.join(assetIconDir, "task_pvm.png"),
    [TaskCategory.Skilling]: path.join(assetIconDir, "task_skilling.png"),
    [TaskCategory.MinigameMisc]: path.join(assetIconDir, "task_minigame.png"),
    [TaskCategory.Leagues]: path.join(assetIconDir, "task_minigame.png"), // temp
    [TaskCategory.MonisChoice]: path.join(assetIconDir, "task_monischoice.png"),
};
const pollNumberEmojis = ["1️⃣", "2️⃣", "3️⃣"];

// Helper method to shorten amounts 5 digits or more (e.g. 120,000 -> 120k) and replace amounts in embeds
function shortenAmount(amount: number): string {
    if (amount >= 10000) {
        return `${Math.floor(amount / 1000)}k`;
    }
    return String(amount);
}

function getTaskPollVoteSummary(tasks: Task[], voteCounts: Record<string, number>): string {
    return tasks.map((task, i) => {
        const taskId = task.id.toString();
        const votes = voteCounts[taskId] ?? 0;
        const name = getTaskDisplayName(task);
        const tierDisplay =
            `🥉 **${shortenAmount(task.amtBronze)}** ` +
            `🥈 **${shortenAmount(task.amtSilver)}** ` +
            `🥇 **${shortenAmount(task.amtGold)}**`;
        const voteText = `**${votes} vote${votes !== 1 ? "s" : ""}**`;
        return `${pollNumberEmojis[i]} ${name}\n${tierDisplay}\n${voteText}`;
    }).join("\n\n");
}

export function getTaskPollIconFile(category: TaskCategory): Array<{ attachment: string; name: string }> {
    const iconPath = categoryIcons[category];
    return iconPath ? [{ attachment: iconPath, name: "category_icon.png" }] : [];
}

export function buildTaskPollEmbed(
    category: TaskCategory,
    tasks: Task[],
    voteCounts: Record<string, number>,
    options?: { endsAt?: Date | null; isClosed?: boolean }
) {
    const endsAt = options?.endsAt ?? null;
    const isClosed = options?.isClosed ?? false;
    const timeString = endsAt ? time(endsAt, TimestampStyles.RelativeTime) : "";
    const description =
        `${getTaskPollVoteSummary(tasks, voteCounts)}` +
        (!isClosed && timeString ? `\n\n Poll closes ${timeString}` : "");

    return new EmbedBuilder()
        .setTitle(`🗳️ ${category} Task Poll`)
        .setDescription(description)
        .setFooter({
            text: isClosed ? "Poll closed. Thanks for voting!" : "Click a button below to vote.",
        })
        .setColor(0x00ae86)
        .setThumbnail("attachment://category_icon.png");
}

export function submissionLabel(submission: Pick<TaskSubmission, "taskName" | "taskEventId">): string {
    return submission.taskName ?? `Task ${submission.taskEventId}`;
}

export function getTaskDisplayName(task: Task, selectedAmount?: number): string {
    let displayName = task.taskName;
    
    if (selectedAmount !== undefined && displayName.includes("{amount}")) {
        displayName = displayName.replace(/\{amount\}/g, shortenAmount(selectedAmount));
    }

    if (task.wildernessReq && !displayName.includes("☠️")) {
        displayName += " ☠️";
    }

    return displayName;
}

// Embed shown for each task event post
export function buildTaskEventEmbed(event: TaskEvent) {
    const taskTitle = getTaskDisplayName(event.task, event.selectedAmount);
    const category = event.category;
    const iconPath = categoryIcons[category];

    const instructionText =
        TaskInstructions[event.task.type] ?? "Include proof of completion showing progress or XP change.";
    const description = event.task.description ? `\n${event.task.description}` : "";

    const tierDisplay = `Amounts required for each tier of completion:\n
🥉 **${shortenAmount(event.amounts?.bronze ?? 0)}**\u2003🥈 **${shortenAmount(event.amounts?.silver ?? 0)}**\u2003🥇 **${shortenAmount(event.amounts?.gold ?? 0)}**`;

    const counts = event.completionCounts ?? { bronze: 0, silver: 0, gold: 0 };
    const completionLine = `**Completions:** 🥉${counts.bronze} 🥈${counts.silver} 🥇${counts.gold}`;

    const embed = new EmbedBuilder()
        .setTitle(`${category} Task`)
        .setDescription(
            `**${taskTitle}**${description}\n\n${tierDisplay}\n\n${completionLine}\n\n**Submission Instructions:**\n${instructionText}\n\nClick **Submit Screenshot(s)** below to make your submission.`
        )
        .setColor(0xa60000)
        .setFooter({ text: `Ends ${event.endTime.toUTCString()} • ${event.id}` })
        .setThumbnail("attachment://category_icon.png");

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`task-submit-${event.id}`)
            .setLabel("📤 Submit Screenshot(s)")
            .setStyle(ButtonStyle.Primary)
    );
    if (category !== TaskCategory.MonisChoice) {
        buttonRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`task-feedback|up|${event.task.id}|${event.id}`)
                .setLabel("👍")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`task-feedback|down|${event.task.id}|${event.id}`)
                .setLabel("👎")
                .setStyle(ButtonStyle.Secondary)
        );
    }

    return {
        embeds: [embed],
        components: [buttonRow],
        files: [{ attachment: iconPath, name: "category_icon.png" }],
    };
}

// Embed shown for informational task lookup (not tied to an active event)
export function buildTaskInfoEmbed(task: Task) {
    const taskTitle = getTaskDisplayName(task);
    const category = task.category;
    const iconPath = categoryIcons[category];
    const instructionText =
        TaskInstructions[task.type] ?? "Include proof of completion showing progress or XP change.";

    const tierDisplay = `Amounts required for each tier of completion:\n\n🥉 **${shortenAmount(task.amtBronze)}**\u2003🥈 **${shortenAmount(task.amtSilver)}**\u2003🥇 **${shortenAmount(task.amtGold)}**`;

    const embed = new EmbedBuilder()
        .setTitle(`${category} Task`)
        .setDescription(
            `**${taskTitle}**\n\n${tierDisplay}\n\n**Submission Instructions:**\n${instructionText}`
        )
        .setColor(0xa60000)
        .setFooter({ text: task.id })
        .setThumbnail("attachment://category_icon.png");

    return {
        embeds: [embed],
        files: [{ attachment: iconPath, name: "category_icon.png" }],
    };
}

export const TIER_DISPLAY: Partial<Record<SubmissionStatus, { emoji: string; name: string }>> = {
    [SubmissionStatus.Bronze]: { emoji: "🥉", name: "Bronze" },
    [SubmissionStatus.Silver]: { emoji: "🥈", name: "Silver" },
    [SubmissionStatus.Gold]: { emoji: "🥇", name: "Gold" },
};

// Embed shown in task verification channel when a submission is received
export function buildSubmissionEmbed(submission: any, taskName: string, event: TaskEvent, heldStatus?: SubmissionStatus) {
    const submissionTime = new Date();
    const eventEndTime = event.endTime;

    const embed = new EmbedBuilder()
        .setTitle("Task Submission")
        .addFields(
            { name: "User", value: `<@${submission.userId}>`, inline: true },
            { name: "Task", value: taskName, inline: true },
            { name: "Message", value: submission.notes || "No message included" },
            { name: "Tier Amounts", value: `🥉 **${shortenAmount(event.amounts?.bronze ?? 0)}** 🥈 **${shortenAmount(event.amounts?.silver ?? 0)}** 🥇 **${shortenAmount(event.amounts?.gold ?? 0)}**`}
        )
        .setTimestamp();

    const held = heldStatus && TIER_DISPLAY[heldStatus];
    if (held) {
        embed.addFields({
            name: "⚠️ WARNING",
            value: `This user already holds **${held.emoji} ${held.name}** for this task.`
        });
    }

    if (eventEndTime && submissionTime.getTime() > eventEndTime.getTime()) {
        embed.addFields({
            name: "⚠️ WARNING",
            value: `This submission was made after the task event ended (${eventEndTime.toUTCString()}).`,
        });
    }

    return embed;
}

// Embed sent to archive once approved/rejected
export function buildArchiveEmbed(submission: any, status: string, taskName: string, reviewedBy: string) {
    return new EmbedBuilder()
        .setTitle(`Task Submission (${status})`)
        .addFields(
            { name: "User", value: `<@${submission.userId}>`, inline: true },
            { name: "Task", value: taskName, inline: true },
            { name: "Message", value: submission.notes || "No message included" },
            ...(submission.rejectionReason
                ? [{ name: "Reason", value: submission.rejectionReason }]
                : []),
            { name: "Reviewed By", value: `<@${reviewedBy}>`, inline: true },
            { name: "Screenshots", value: "See attached screenshots(s) below." }
        )
        .setTimestamp();
}

// Embed shown when a prize draw winner is announced
export function buildPrizeDrawEmbed(
    winnerUsername: string,
    totalSubmissions: number,
    totalParticipants: number,
    start: string,
    end: string,
    tierCounts?: { bronze: number; silver: number; gold: number }
) {
    const formattedStart = new Date(start).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
    const formattedEnd = new Date(end).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

    const prizeIconPath = path.join(assetIconDir, "task_prize.png");

    const tierDisplay = tierCounts
        ? `🥉 ${tierCounts.bronze} 🥈 ${tierCounts.silver} 🥇 ${tierCounts.gold}`
        : "";

    const embed = new EmbedBuilder()
        .setTitle("🏆 And the winner is...")
        .setColor(0x0003bd)
        .setDescription(
            "During this task period, there were...\n\n" +
            `${tierDisplay}\n\n` +
            `**${totalSubmissions}** submissions from **${totalParticipants}** participants!\n\n` +
            `🎉 Congratulations **${winnerUsername}**!\n\n` +
            `Please message a **Task Admin** to claim your prize.`
        )
        .setThumbnail("attachment://task_prize.png")
        .setFooter({ text: `Task Period: ${formattedStart} to ${formattedEnd}` });

    return {
        embeds: [embed],
        files: [{ attachment: prizeIconPath, name: "task_prize.png" }],
    };
}
