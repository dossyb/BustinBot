import { TextChannel, ButtonBuilder, ButtonStyle, ActionRowBuilder, Client, Message } from 'discord.js';
import type { TaskSubmission } from '../../models/TaskSubmission';
import { SubmissionStatus } from '../../models/TaskSubmission';
import { buildSubmissionEmbed, buildArchiveEmbed, buildTaskEventEmbed } from './TaskEmbeds';
import { isTextChannel } from '../../utils/ChannelUtils';
import type { TaskEvent } from 'models/TaskEvent';
import type { ITaskRepository } from 'core/database/interfaces/ITaskRepo';
import { normaliseFirestoreDates } from 'utils/DateUtils';

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
            .setCustomId(`approve_bronze_${submission.id}`)
            .setLabel('🥉 Bronze')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`approve_silver_${submission.id}`)
            .setLabel('🥈 Silver')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`approve_gold_${submission.id}`)
            .setLabel('🥇 Gold')
            .setStyle(ButtonStyle.Primary),
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

    if (
        submission.status === SubmissionStatus.Bronze ||
        submission.status === SubmissionStatus.Silver ||
        submission.status === SubmissionStatus.Gold
    ) {
        const tierMap = {
            [SubmissionStatus.Bronze]: { emoji: '🥉', name: 'Bronze' },
            [SubmissionStatus.Silver]: { emoji: '🥈', name: 'Silver' },
            [SubmissionStatus.Gold]: { emoji: '🥇', name: 'Gold' },
        } as const;

        const tierInfo = tierMap[submission.status];
        const rollCount = submission.prizeRolls ?? 0;
        const plural = rollCount === 1 ? '' : 's';

        await user.send(
            `✅ Your submission for **${submission.taskName ?? `Task ${submission.taskEventId}`}** has been approved for ${tierInfo.emoji} **${tierInfo.name} tier** (${rollCount} prize roll${plural})!`
        );
    } else if (submission.status === SubmissionStatus.Rejected) {
        const reason = submission.rejectionReason ?? 'No reason provided.';
        await user.send(
            `❌ Your submission for **${submission.taskName ?? `Task ${submission.taskEventId}`}** was rejected.\n**Reason:** ${reason}`
        );
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

export async function updateTaskCounter(client: Client, taskEventId: string, userId?: string, repo?: ITaskRepository) {
    if (!repo) {
        console.warn(`[UpdateTaskCounter] Missing repository reference.`);
        return;
    }

    const event = await repo.getTaskEventById(taskEventId);
    if (!event) return;

    const userAlreadyCounted = event.completedUserIds?.includes(userId ?? '') ?? false;

    if (!userAlreadyCounted && userId) {
        event.completedUserIds = [...(event.completedUserIds ?? []), userId];
        event.completionCount = (event.completionCount ?? 0) + 1;
        await repo.createTaskEvent(event);
    }

    if (!event.channelId || !event.messageId) {
        console.warn(`[UpdateTaskCounter] No channel/message ID stored for task event ${event.id}`);
        return;
    }

    const channel = client.channels.cache.get(event.channelId) as TextChannel;
    if (!channel || !isTextChannel(channel)) return;

    try {
        const message = await channel.messages.fetch(event.messageId);
        if (!message) {
            console.warn(`[UpdateTaskCounter] Could not fetch message ${event.messageId} for event ${event.id}`);
            return;
        }

        if (event.startTime && typeof (event.startTime as any).toDate === 'function') {
            event.startTime = (event.startTime as any).toDate();
        }
        if (event.endTime && typeof (event.endTime as any).toDate === 'function') {
            event.endTime = (event.endTime as any).toDate();
        }

        const safeEvent = normaliseFirestoreDates(event);
        const updatedEmbed = buildTaskEventEmbed(safeEvent);

        await message.edit({
            embeds: updatedEmbed.embeds,
            components: updatedEmbed.components,
            files: updatedEmbed.files,
        });

        console.log(`[UpdateTaskCounter] Updated completions for ${event.task.taskName}: ${event.completionCount}`);
    } catch (err) {
        console.error(`[UpdateTaskCounter] Failed to update task embed for event ${event.id}:`, err);
    }
}