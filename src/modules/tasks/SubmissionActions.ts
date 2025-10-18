import { TextChannel, ButtonBuilder, ButtonStyle, ActionRowBuilder, Client } from 'discord.js';
import type { Channel } from 'discord.js';
import type { TaskSubmission } from '../../models/TaskSubmission';
import { SubmissionStatus } from '../../models/TaskSubmission';
import { buildSubmissionEmbed, buildArchiveEmbed } from './TaskEmbeds';
import { isTextChannel } from '../../utils/ChannelUtils';

// Configurable constants (replace with environment variable later)
const ADMIN_CHANNEL_NAME = 'task-admin';
const ARCHIVE_CHANNEL_NAME = 'bot-archive';

export async function postToAdminChannel(client: Client, submission: TaskSubmission) {
    const channel = client.channels.cache.find((c): c is TextChannel => isTextChannel(c) && c.name === ADMIN_CHANNEL_NAME) as TextChannel;
    if (!channel) return;

    const taskLabel = submission.taskName ?? `Task ${submission.taskEventId}`;
    const embed = buildSubmissionEmbed(submission, taskLabel);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`approve_${submission.id}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`reject_${submission.id}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger)
    );

    // First message: embed with info and buttons
    const sentMessage = await channel.send({ embeds: [embed], components: [buttons] });
    submission.message = sentMessage.id;

    // Second message: screenshots as file uploads
    if (submission.screenshotUrls?.length > 0) {
        const filesToSend = submission.screenshotUrls.slice(0, 10);
        const sentScreens = await channel.send({
            content: `Submission screenshots for <@${submission.userId}> — ${taskLabel}:`,
            files: filesToSend
        });
        submission.screenshotMessage = sentScreens.id;
    }
}

export async function notifyUser(client: Client, submission: TaskSubmission) {
    const user = await client.users.fetch(submission.userId);
    if (!user) return;

    if (submission.status === SubmissionStatus.Approved) {
        await user.send(`✅ Your submission for **${submission.taskName ?? `Task ${submission.taskEventId}`}** has been approved!`);
    } else if (submission.status === SubmissionStatus.Rejected) {
        const reason = submission.rejectionReason ?? "No reason provided.";
        await user.send(`❌ Your submission for **${submission.taskName ?? `Task ${submission.taskEventId}`}** was rejected.\n**Reason:** ${reason}`);
    }
}

export async function archiveSubmission(client: Client, submission: TaskSubmission) {
    const archive = client.channels.cache.find((c): c is TextChannel => isTextChannel(c) && c.name === ARCHIVE_CHANNEL_NAME) as TextChannel;
    if (!archive) return;

    const embed = buildArchiveEmbed(
        submission,
        submission.status,
        submission.taskName ?? `Task ${submission.taskEventId}`,
        submission.reviewedBy ?? "Unknown"
    );

    await archive.send({ embeds: [embed] });

    if (submission.screenshotUrls?.length > 0) {
        const filesToArchive = submission.screenshotUrls.slice(0, 10);
        await archive.send({
            content: `Archived screenshots for <@${submission.userId}>:`,
            files: filesToArchive
        });
    }
}

export async function updateTaskCounter(client: Client, taskEventId: string) {
    // Stub for now - fetch approved submission count, update counter field on task post
    console.log(`Updating task counter for taskEventId: ${taskEventId}`);
}