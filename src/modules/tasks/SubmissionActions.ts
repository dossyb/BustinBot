import { TextChannel, ButtonBuilder, ButtonStyle, ActionRowBuilder, Client } from 'discord.js';
import type { Channel } from 'discord.js';
import type { TaskSubmission } from '../../models/TaskSubmission';
import { SubmissionStatus } from '../../models/TaskSubmission';
import { buildSubmissionEmbed, buildArchiveEmbed } from './TaskEmbeds';

// Configurable constants (replace with environment variable later)
const ADMIN_CHANNEL_NAME = 'task-admin';
const ARCHIVE_CHANNEL_NAME = 'bot-archive';

function isTextChannel(channel: Channel): channel is TextChannel {
    return channel.isTextBased() && 'name' in channel;
}

export async function postToAdminChannel(client: Client, submission: TaskSubmission) {
    const channel = client.channels.cache.find((c): c is TextChannel => isTextChannel(c) && c.name === ADMIN_CHANNEL_NAME) as TextChannel;
    if (!channel) return;

    const embed = buildSubmissionEmbed(submission, `Task ${submission.taskEventId}`);

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

    await channel.send({ embeds: [embed], components: [buttons] });
}

export async function notifyUser(client: Client, submission: TaskSubmission) {
    const user = await client.users.fetch(submission.userId);
    if (!user) return;

    if (submission.status === SubmissionStatus.Approved) {
        await user.send(`✅ Your submission for Task ${submission.taskEventId} has been approved!`);
    } else if (submission.status === SubmissionStatus.Rejected) {
        const reason = submission.rejectionReason ?? "No reason provided.";
        await user.send(`❌ Your submission for Task ${submission.taskEventId} was rejected.\n**Reason:** ${reason}`);
    }
}

export async function archiveSubmission(client: Client, submission: TaskSubmission) {
    const archive = client.channels.cache.find((c): c is TextChannel => isTextChannel(c) && c.name === ARCHIVE_CHANNEL_NAME) as TextChannel;
    if (!archive) return;

    const embed = buildArchiveEmbed(
        submission,
        submission.status,
        `Task ${submission.taskEventId}`,
        submission.reviewedBy ?? "Unknown"
    );

    await archive.send({ embeds: [embed] });
}

export async function updateTaskCounter(client: Client, taskEventId: string) {
    // Stub for now - fetch approved submission count, update counter field on task post
    console.log(`Updating task counter for taskEventId: ${taskEventId}`);
}