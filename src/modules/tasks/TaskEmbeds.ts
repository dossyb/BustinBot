import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, embedLength } from "discord.js";
import path from 'path';
import type { TaskEvent } from "../../models/TaskEvent";
import type { Task } from "../../models/Task";
import { fileURLToPath } from "url";
import { TaskCategory } from "../../models/Task";
import { TaskInstructions } from "./TaskInstructions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const categoryIcons: Record<TaskCategory, string> = {
    [TaskCategory.PvM]: path.resolve(__dirname, '../../assets/icons/task_pvm.png'),
    [TaskCategory.Skilling]: path.resolve(__dirname, '../../assets/icons/task_skilling.png'),
    [TaskCategory.MinigameMisc]: path.resolve(__dirname, '../../assets/icons/task_minigame.png'),
    [TaskCategory.Leagues]: path.resolve(__dirname, '../../assets/icons/task_minigame.png'), // temp
};

export function getTaskDisplayName(task: Task, selectedAmount?: number): string {
    if (selectedAmount !== undefined && task.taskName.includes("{amount}")) {
        return task.taskName.replace(/\{amount\}/g, String(selectedAmount));
    }

    if (task.wildernessReq) {
        task.taskName += " ☠️";
    }

    return task.taskName;
}

// Embed shown for each task event post
export function buildTaskEventEmbed(event: TaskEvent) {
    const taskTitle = getTaskDisplayName(event.task, event.selectedAmount);
    const category = event.category;
    const iconPath = categoryIcons[category];

    const instructionText =
        TaskInstructions[event.task.type] ?? "Include proof of completion showing progress or XP change.";

    const tierDisplay = `Amounts required for each tier of completion (1, 2 and 3 prize rolls respectively):\n
🥉 **${event.amounts?.bronze ?? 0}**\u2003🥈 **${event.amounts?.silver ?? 0}**\u2003🥇 **${event.amounts?.gold ?? 0}**`;

    const counts = event.completionCounts ?? { bronze: 0, silver: 0, gold: 0 };
    const completionLine = `**Completions:** 🥉${counts.bronze} 🥈${counts.silver} 🥇${counts.gold}`;

    const embed = new EmbedBuilder()
        .setTitle(`${category} Task`)
        .setDescription(
            `**${taskTitle}**\n\n${tierDisplay}\n\n${completionLine}\n\n**Submission Instructions:**\n${instructionText}\n\nClick **Submit Screenshot** below to make your submission.`
        )
        .setColor(0xa60000)
        .setFooter({ text: `Ends ${event.endTime.toUTCString()} • ${event.id}` })
        .setThumbnail("attachment://category_icon.png");

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`task-submit-${event.id}`)
            .setLabel('📤 Submit Screenshot')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`task-feedback-up-${event.task.id}`)
            .setLabel('👍')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`task-feedback-down-${event.task.id}`)
            .setLabel('👎')
            .setStyle(ButtonStyle.Secondary)
    );

    return {
        embeds: [embed],
        components: [buttonRow],
        files: [{ attachment: iconPath, name: "category_icon.png" }],
    };
}

// Embed shown in task verification channel when a submission is received
export function buildSubmissionEmbed(submission: any, taskName: string) {
    const embed = new EmbedBuilder()
        .setTitle('Task Submission')
        .addFields(
            { name: 'User', value: `<@${submission.userId}>`, inline: true },
            { name: 'Task', value: taskName, inline: true },
            { name: 'Message', value: submission.notes || "No message included" }
        )
        .setTimestamp();

    if (submission.alreadyApproved) {
        embed.addFields({
            name: '⚠️ Warning',
            value: 'This user already has an **approved submission** for this task.'
        });
    }

    return embed;
}

// Embed sent to archive once approved/rejected
export function buildArchiveEmbed(submission: any, status: string, taskName: string, reviewedBy: string) {
    return new EmbedBuilder()
        .setTitle(`Task Submission (${status})`)
        .addFields(
            { name: 'User', value: `<@${submission.userId}>`, inline: true },
            { name: 'Task', value: taskName, inline: true },
            { name: 'Message', value: submission.notes || "No message included" },
            ...(submission.reason
                ? [{ name: 'Reason', value: submission.reason }]
                : []),
            { name: 'Reviewed By', value: `<@${reviewedBy}>`, inline: true },
            { name: 'Screenshots', value: "See attached screenshots(s) below." }
        )
        .setTimestamp();
}

// Embed shown when a prize draw winner is announced
export function buildPrizeDrawEmbed(winnerId: string, totalSubmissions: number, totalParticipants: number, start: string, end: string, tierCounts?: { bronze: number; silver: number; gold: number }) {
    const formattedStart = new Date(start).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const formattedEnd = new Date(end).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

    const prizeIconPath = path.resolve(__dirname, '../../assets/icons/task_prize.png');

    const tierDisplay = tierCounts
        ? `🥉 ${tierCounts.bronze} 🥈 ${tierCounts.silver} 🥇 ${tierCounts.gold}`
        : '';

    const embed = new EmbedBuilder()
        .setTitle("🏆 And the winner is...")
        .setColor(0x0003bd)
        .setDescription(
            'During this task period, there were...\n\n' +
            `${tierDisplay}\n\n` +
            `**${totalSubmissions}** submissions from **${totalParticipants}** participants!\n\n` +
            `🎉 Congratulations <@${winnerId}>!\n\n` +
            `Please message a **Task Admin** to claim your prize.`
        )
        .setThumbnail("attachment://task_prize.png")
        .setFooter({ text: `Task Period: ${formattedStart} to ${formattedEnd}` });

    return {
        embeds: [embed],
        files: [{ attachment: prizeIconPath, name: "task_prize.png" }],
    };
}