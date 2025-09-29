import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import type { APIEmbed } from "discord.js";
import type { TaskEvent } from "../../models/TaskEvent";

// Embed shown for each task event post
export function buildTaskEventEmbed(event: TaskEvent) {
    const embed: APIEmbed = {
        title: 'This Week\'s Task',
        description: `${event.task.taskName.replace(
            "{amount}",
            String(event.selectedAmount ?? "")
        )}\n\nInclude the keyword **${event.keyword}** in your screenshot.`,
        footer: { text: `Ends ${event.endTime.toUTCString()}` },
        color: 0xa60000,
    };

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`task-submit-${event.task.id}`)
            .setLabel('📤 Submit Screenshot')
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [buttonRow] };
}

// Embed shown in task verification channel when a submission is received
export function buildSubmissionEmbed(submission: any, taskName: string) {
    return new EmbedBuilder()
    .setTitle('Task Submission')
    .addFields(
        { name: 'User', value: `<@${submission.userId}>`, inline: true },
        { name: 'Task', value: taskName, inline: true },
        { name: 'Message', value: submission.notes || "No message included" }
    )
    .setImage(submission.screenshotUrl)
    .setTimestamp();
}

// Embed sent to archive once approved/rejected
export function buildArchiveEmbed(submission: any, status: string, taskName: string, reviewedBy: string) {
    return new EmbedBuilder()
    .setTitle(`Task Submission (${status})`)
    .addFields(
        { name: 'User', value: `<@${submission.userId}>`, inline: true },
        { name: 'Task', value: taskName, inline: true},
        { name: 'Message', value: submission.message || "No message included" },
        ...(submission.reason 
            ? [{ name: 'Reason', value: submission.reason }]
            : []),
        { name: 'Reviewed By', value: `<@${reviewedBy}>`, inline: true }
    )
    .setImage(submission.screenshotUrl)
    .setTimestamp();
}