import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, embedLength } from "discord.js";
import type { APIEmbed } from "discord.js";
import type { TaskEvent } from "../../models/TaskEvent";
import type { Task } from "../../models/Task";

export function getTaskDisplayName(task: Task, selectedAmount?: number): string {
    if (selectedAmount !== undefined && task.taskName.includes("{amount}")) {
        return task.taskName.replace(/\{amount\}/g, String(selectedAmount));
    }
    return task.taskName;
}

// Embed shown for each task event post
export function buildTaskEventEmbed(event: TaskEvent) {
    const taskTitle = getTaskDisplayName(event.task, event.selectedAmount);
    const embed: APIEmbed = {
        title: '**This Week\'s Task**',
        description: `**${taskTitle}**\n\n**Submission instructions:**\n
        <insert instructions here>\n\n
        🔑 Keyword: **${event.keyword}** 🔑\n
        Click the **Submit Screenshot** button below to make your submission.`,
        footer: { text: `Task ends ${event.endTime.toUTCString()}` },
        color: 0xa60000,
    };

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

    return { embeds: [embed], components: [buttonRow] };
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
export function buildPrizeDrawEmbed(winnerId: string, totalSubmissions: number, totalParticipants: number, start: string, end: string) {
    const formattedStart = new Date(start).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const formattedEnd = new Date(end).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

    return new EmbedBuilder()
        .setTitle("🏆 And the winner is...")
        .setColor(0x0003bd)
        .setDescription(
            'During this task period, there were...\n\n' +
            `**${totalSubmissions}** submissions from **${totalParticipants}** participants!\n\n` +
            `🎉 Congratulations <@${winnerId}>!\n\n` +
            `Please message a **Task Admin** to claim your prize.`
        )
        .setFooter({ text: `Task Period: ${formattedStart} to ${formattedEnd}`})
}