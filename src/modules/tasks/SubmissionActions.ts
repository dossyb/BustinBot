import { ButtonBuilder, ButtonStyle, ActionRowBuilder, Client } from "discord.js";
import type { TaskSubmission } from "../../models/TaskSubmission.js";
import { SubmissionStatus } from "../../models/TaskSubmission.js";
import { buildSubmissionEmbed, buildArchiveEmbed, submissionLabel, TIER_DISPLAY } from "./TaskEmbeds.js";
import { configuredChannel } from "../../utils/ChannelUtils.js";
import type { ITaskRepository } from "../../core/database/interfaces/ITaskRepo.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../utils/MentionUtils.js";
import { refreshTaskEventMessage } from "./HandleTaskStart.js";

export async function postToAdminChannel(client: Client, submission: TaskSubmission, services: ServiceContainer): Promise<boolean> {
    const channel = await configuredChannel(client, services, "taskVerification");
    if (!channel) return false;

    const taskRepo = services.repos.taskRepo;
    const taskEvent = await taskRepo.getTaskEventById(submission.taskEventId);
    if (!taskEvent) return false;

    // Check if this user already has an approved submission for this task
    const heldStatus = await services.tasks.getHeldStatus(submission.userId, submission.taskEventId);

    const taskLabel = submissionLabel(submission);
    const embed = buildSubmissionEmbed(submission, taskLabel, taskEvent, heldStatus);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`approve_bronze_${submission.id}`)
            .setLabel("🥉 Bronze")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`approve_silver_${submission.id}`)
            .setLabel("🥈 Silver")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`approve_gold_${submission.id}`)
            .setLabel("🥇 Gold")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`reject_${submission.id}`)
            .setLabel("Reject")
            .setStyle(ButtonStyle.Danger)
    );

    // First message: embed with info and buttons
    const sentMessage = await channel.send({ embeds: [embed], components: [buttons] });
    submission.message = sentMessage.id;

    // Second message: screenshots as file uploads
    if (submission.screenshotUrls?.length > 0) {
        const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);
        try {
            const sentScreens = await channel.send({
                ...withSuppressedMentions({ content: `Submission screenshots for <@${submission.userId}> — ${taskLabel}:` }, suppressMentions),
                files: submission.screenshotUrls
            });
            submission.screenshotMessage = sentScreens.id;
        } catch (err) {
            await sentMessage.delete().catch((deleteErr: unknown) => console.warn(`[Admin Embed Cleanup Error]:`, deleteErr));
            throw err;
        }
    }
    return true;
}

export async function notifyUser(client: Client, submission: TaskSubmission, streakLine?: string, keptStatus?: SubmissionStatus) {
    const user = await client.users.fetch(submission.userId);
    if (!user) return;

    const tierInfo = TIER_DISPLAY[submission.status];
    if (tierInfo) {
        const kept = keptStatus && TIER_DISPLAY[keptStatus];
        if (kept) {
            await user.send(
                `✅ Your submission for **${submissionLabel(submission)}** has been approved for ${tierInfo.emoji} **${tierInfo.name} tier**. You already hold ${kept.emoji} **${kept.name} tier** for this task, so your tier is unchanged.`
            );
            return;
        }

        await user.send(
            `✅ Your submission for **${submissionLabel(submission)}** has been approved for ${tierInfo.emoji} **${tierInfo.name} tier**!${streakLine ?? ""}`
        );
    } else if (submission.status === SubmissionStatus.Rejected) {
        const reason = submission.rejectionReason ?? "No reason provided.";
        await user.send(
            `❌ Your submission for **${submissionLabel(submission)}** was rejected.\n**Reason:** ${reason}`
        );
    }
}

export async function archiveSubmission(client: Client, submission: TaskSubmission, services: ServiceContainer): Promise<boolean> {
    const archive = await configuredChannel(client, services, "botArchive");
    if (!archive) return false;

    const embed = buildArchiveEmbed(
        submission,
        submission.status,
        submissionLabel(submission),
        submission.reviewedBy ?? "Unknown"
    );

    await archive.send({ embeds: [embed] });

    // The member's DM links expire, so the screenshots are copied from the review post
    const verification = await configuredChannel(client, services, "taskVerification");
    const screenshots = submission.screenshotMessage
        ? await verification?.messages.fetch(submission.screenshotMessage).catch(() => null)
        : null;
    if (screenshots?.attachments.size) {
        const suppressMentions = await isMentionSuppressed(services.guilds, services.guildId);
        await archive.send(withSuppressedMentions({
            content: `Archived screenshots for <@${submission.userId}>:`,
            files: screenshots.attachments.map((attachment) => attachment.url)
        }, suppressMentions));
    }
    return true;
}

export async function updateTaskCounter(client: Client, taskEventId: string, userId?: string, repo?: ITaskRepository, newTier?: SubmissionStatus, prevTier?: SubmissionStatus) {
    if (!repo) {
        console.warn(`[UpdateTaskCounter] Missing repository reference.`);
        return;
    }

    const event = await repo.getTaskEventById(taskEventId);
    if (!event) return;

    event.completionCounts = event.completionCounts ?? { bronze: 0, silver: 0, gold: 0 };

    if (!userId || !newTier) {
        console.warn(`[UpdateTaskCounter] Missing userId or newTier for event ${event.id}`);
        return;
    }

    if (prevTier) {
        event.completionCounts[prevTier.toLowerCase() as "bronze" | "silver" | "gold"]--;
    }

    event.completionCounts[newTier.toLowerCase() as "bronze" | "silver" | "gold"]++;

    await repo.createTaskEvent(event);

    if (!event.channelId || !event.messageId) {
        console.warn(`[UpdateTaskCounter] No channel/message ID stored for task event ${event.id}`);
        return;
    }

    try {
        await refreshTaskEventMessage(client, event);

        console.log(`[UpdateTaskCounter] Updated completions for ${event.task.taskName}: 🥉${event.completionCounts.bronze} 🥈${event.completionCounts.silver} 🥇${event.completionCounts.gold}`);
    } catch (err) {
        console.error(`[UpdateTaskCounter] Failed to update task embed for event ${event.id}:`, err);
    }
}
