import { ButtonInteraction, StringSelectMenuInteraction, Message, Client, ModalSubmitInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { SubmissionStatus } from '../../models/TaskSubmission.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { getTaskDisplayName } from './TaskEmbeds.js';
import { handleUpdateTaskModal } from './HandleUpdateTaskModal.js';
import { getTierPoints, incrementLifetimePoints, incrementPeriodicPoints } from './TaskLeaderboards.js';
import { applyTaskMilestoneRoles } from './TaskMilestones.js';
import { isMentionSuppressed, withSuppressedMentions } from '../../utils/MentionUtils.js';
import type { UserStats } from '../../models/UserStats.js';

const MAX_SCREENSHOTS = 10;

const TIER_STAT_MAP: Record<string, keyof UserStats> = {
    bronze: "tasksCompletedBronze",
    silver: "tasksCompletedSilver",
    gold: "tasksCompletedGold",
};

// STEP 1: "Submit Screenshot" button clicked on task embed
export async function handleSubmitButton(interaction: ButtonInteraction, services: ServiceContainer) {
    await interaction.deferReply({ flags: 1 << 6 });

    const parts = interaction.customId.split('-');
    const taskEventId = parts.slice(2).join('-');

    if (!taskEventId) {
        await interaction.editReply({ content: "Task ID missing from interaction." });
        return;
    }

    const taskRepo = services.repos.taskRepo;
    if (!taskRepo) {
        await interaction.editReply({ content: "Task repository unavailable." });
        return;
    }

    const taskEvent = await taskRepo.getTaskEventById(taskEventId);
    if (!taskEvent) {
        await interaction.editReply({
            content: "That task is no longer active. Please check the latest task announcement.",
        });
        return;
    }

    const taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);
    const userId = interaction.user.id;

    services.tasks.setPendingTask(userId, taskEventId);

    try {
        await interaction.user.send(
            `Please upload your screenshot(s) for **${taskName}** and include any notes/comments in the same message.`
        );
        await interaction.editReply({
            content: `Check your DMs to submit your screenshot(s) for **${taskName}**!`,
        });
    } catch {
        services.tasks.consumePendingTask(userId);
        await interaction.editReply({
            content: "I couldn't send you a DM. Please enable direct messages from server members and try again."
        });
    }
}

// STEP 2: User confirms task from select menu
export async function handleTaskSelect(interaction: StringSelectMenuInteraction, services: ServiceContainer) {
    const [, , userId] = interaction.customId.split('-');

    if (!userId) {
        await interaction.reply({
            content: "User ID missing from selection.",
            flags: 1 << 6
        });
        return;
    }

    const selectedTaskEventId = interaction.values[0];
    if (!selectedTaskEventId) {
        await interaction.reply({
            content: "No task selected.",
            flags: 1 << 6
        });
        return;
    }

    services.tasks.setPendingTask(userId, selectedTaskEventId);
    try {
        const submission = await services.tasks.createSubmission(userId, selectedTaskEventId);

        await interaction.reply({
            content: `Thank you for confirming. Now upload your screenshot for **${submission.taskName ?? 'your task'}** and include any notes/comments in the same message.`,
            flags: 64
        });
    } catch (error) {
        console.error('[TaskSelect] Failed to create submission:', error);
        await interaction.reply({
            content: "There was a problem creating your submission. Please try again or contact a Task Admin.",
            flags: 64
        });
    }
}

// STEP 3: User sends screenshot + notes in DM
export async function handleDirectMessage(message: Message, client: Client, services: ServiceContainer) {
    if (message.author.bot || message.channel.type !== 1) return;

    const taskEventId = services.tasks.consumePendingTask(message.author.id);
    const pending = taskEventId ? await services.tasks.getPendingSubmission(message.author.id, taskEventId) : undefined;
    if (!pending && !taskEventId) return;

    let submission = pending;
    if (!submission) {
        try {
            submission = await services.tasks.createSubmission(message.author.id, taskEventId!);
        } catch (error) {
            console.error('[TaskDM] Failed to create submission from DM:', error);
            await message.reply("Couldn't locate the task details. Please try submitting again or contact a Task Admin.");
            return;
        }
    }

    if (!submission) return;

    const attachments = message.attachments;

    const imageUrls: string[] = [];
    attachments.forEach((attachment) => {
        if (attachment.contentType?.startsWith("image/")) {
            imageUrls.push(attachment.url);
        }
    });

    if (imageUrls.length === 0) {
        await message.reply("Please attach at least one image for your submission.");
        return;
    }

    const notes = message.content.trim() || undefined;

    const limitedImages = imageUrls.slice(0, MAX_SCREENSHOTS);
    await services.tasks.completeSubmission(client, submission.id, limitedImages, services, notes);
    await message.reply(`✅ Submission for **${submission.taskName ?? 'your task'}** received with ${limitedImages.length} screenshot${limitedImages.length === 1 ? '' : 's'} and sent for review!`);
}

// STEP 4: Admin clicks Approve/Reject
export async function handleAdminButton(interaction: ButtonInteraction, services: ServiceContainer) {
    const customId = interaction.customId;

    // Second-step cancel action from confirmation prompt
    if (customId.startsWith('review-cancel|')) {
        await interaction.update({
            content: 'Review action cancelled. No changes were made.',
            components: [],
        });
        return;
    }

    // Second-step confirm action from confirmation prompt
    if (customId.startsWith('review-confirm|')) {
        const parts = customId.split('|');
        const confirmAction = parts[1];
        const maybeTier = parts[2];
        const submissionId = parts.slice(3).join('|').trim();

        if (!confirmAction || !submissionId) {
            await interaction.update({
                content: 'Invalid confirmation payload. Please try again.',
                components: [],
            });
            return;
        }

        if (confirmAction === 'reject') {
            const modal = new ModalBuilder()
                .setCustomId(`reject_reason_${submissionId}`)
                .setTitle('Reject Submission')
                .addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder()
                            .setCustomId('reason')
                            .setLabel('Rejection Reason')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(false)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        const tier = maybeTier as 'bronze' | 'silver' | 'gold';
        const validTiers = ['bronze', 'silver', 'gold'];

        if (!validTiers.includes(tier)) {
            await interaction.update({
                content: 'Invalid tier selected for approval.',
                components: [],
            });
            return;
        }

        // Check current submission status to prevent race condition on concurrent approvals
        const taskRepo = services.repos.taskRepo;
        if (!taskRepo) {
            await interaction.update({
                content: 'Task repository unavailable.',
                components: [],
            });
            return;
        }

        const currentSubmission = await taskRepo.getSubmissionById(submissionId);
        if (!currentSubmission) {
            await interaction.update({
                content: 'Submission not found.',
                components: [],
            });
            return;
        }

        // Race condition guard: reject if already approved at same or higher tier
        const tierOrder = { bronze: 1, silver: 2, gold: 3 };
        const currentTierLevel = tierOrder[currentSubmission.status as keyof typeof tierOrder] ?? 0;
        const requestedTierLevel = tierOrder[tier];

        if (currentTierLevel >= requestedTierLevel) {
            await interaction.update({
                content: `⚠️ This submission is already approved at ${currentSubmission.status === 'pending' ? 'pending' : currentSubmission.status} tier or higher. Another admin may have processed this.`,
                components: [],
            });
            return;
        }

        await interaction.deferUpdate();
        await interaction.editReply({
            content: `⏳ Processing approval...`,
            components: [],
        });

        const reviewerId = interaction.user.id;

        try {
            const result = await services.tasks.updateSubmissionTier(
                interaction.client,
                submissionId,
                tier,
                reviewerId,
                services
            );

            if (!result) {
                await interaction.editReply({ content: "⚠️ This submission has already been processed or the user already holds this tier." });
                return;
            }

            const userRepo = services.repos.userRepo;
            if (userRepo) {
                const { userId } = result;
                const prevStat = result.previousStatus ? TIER_STAT_MAP[result.previousStatus] : undefined;
                const newStat = TIER_STAT_MAP[tier];

                try {
                    if (prevStat && newStat) {
                        await userRepo.updateTierStat(userId, prevStat, newStat);
                    } else if (newStat) {
                        await userRepo.incrementStat(userId, newStat, 1);
                    }
                } catch (err) {
                    console.warn(`[Stats] Failed to update tier stats for ${userId}:`, err);
                }
            } else {
                console.warn("[Stats] UserRepo unavailable; skipping task completion increment.");
            }

            const points = getTierPoints(tier);
            const previousPoints = result.previousTierPoints ?? 0;
            const deltaPoints = Math.max(0, points - previousPoints);

            if (deltaPoints > 0) {
                await incrementLifetimePoints(services, result.userId, deltaPoints);
                await incrementPeriodicPoints(services, result.userId, deltaPoints, result.taskEventId, tier);
            }

            await applyTaskMilestoneRoles(interaction.client, services, result.userId);

            const channel = interaction.channel as TextChannel;
            const formattedTier = tier.charAt(0).toUpperCase() + tier.slice(1);
            const suppressMentions = await isMentionSuppressed(services.guilds, interaction.guildId);
            const approvalMessage = `✅ <@${reviewerId}> approved **${formattedTier} tier** for submission by <@${result.userId}> on **${result.taskName ?? `Task ${result.taskEventId}`}** (${result.prizeRolls ?? 0} roll${(result.prizeRolls ?? 0) > 1 ? 's' : ''}).`;
            if (suppressMentions) {
                await channel.send(withSuppressedMentions({ content: approvalMessage }, true));
            } else {
                await channel.send(approvalMessage);
            }

            await interaction.editReply({
                content: `✅ Submission approved for **${formattedTier} tier** (${result.prizeRolls ?? 0} roll${(result.prizeRolls ?? 0) > 1 ? 's' : ''}) and archived.`,
                components: []
            });
        } catch (err) {
            console.error('[TaskInteractions] Tier approval failed:', err);
            await interaction.editReply({ content: "❌ Failed to process tier approval. Check logs for details." });
        }

        return;
    }

    let action: string | undefined;
    let submissionId: string | undefined;
    let maybeTier: string | undefined;

    if (customId.startsWith('reject_')) {
        action = 'reject';
        submissionId = customId.slice('reject_'.length).trim();
    } else if (customId.startsWith('approve_')) {
        action = 'approve';
        const parts = customId.split('_');
        maybeTier = parts[1];
        submissionId = parts.slice(2).join('_').trim();
    }

    if (!submissionId) {
        await interaction.reply({ content: "Submission ID missing from interaction.", flags: 1 << 6 });
        return;
    }
    if (!action) {
        await interaction.reply({ content: "Unknown task action.", flags: 1 << 6 });
        return;
    }

    const reviewerId = interaction.user.id;

    if (action === 'reject') {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`review-confirm|reject||${submissionId}`)
                .setLabel('Confirm Reject')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`review-cancel|${submissionId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: 'Are you sure you want to reject this submission?',
            components: [row],
            flags: 1 << 6,
        });
        return;
    }

    // Handle tier approvals
    const tier = maybeTier as 'bronze' | 'silver' | 'gold';
    const validTiers = ['bronze', 'silver', 'gold'];

    if (action === 'approve' && validTiers.includes(tier)) {
        const formattedTier = tier.charAt(0).toUpperCase() + tier.slice(1);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`review-confirm|approve|${tier}|${submissionId}`)
                .setLabel(`Confirm ${formattedTier}`)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`review-cancel|${submissionId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: `Are you sure you want to approve this submission for **${formattedTier}** tier?`,
            components: [row],
            flags: 1 << 6,
        });

        return;
    }
}

// STEP 5: Modal submit for rejection reason
export async function handleRejectionModal(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    // Acknowledge the modal submission ephemerally
    await interaction.deferReply({ flags: 1 << 6 });

    const reviewerId = interaction.user.id;
    const reason = interaction.fields.getTextInputValue('reason');
    const submissionId = interaction.customId.split('_')[2];
    if (!submissionId) {
        await interaction.reply({ content: "Submission ID missing from interaction.", flags: 1 << 6 });
        return;
    }

    const updated = await services.tasks.updateSubmissionStatus(
        interaction.client,
        submissionId,
        SubmissionStatus.Rejected,
        reviewerId,
        services,
        reason
    );

    // Update the ephemeral reply
    await interaction.editReply({
        content: "❌ Submission rejected and archived."
    });

    // Post a visible message in the admin channel
    const guildConfig = await services.guilds.get(services.guildId);
    const verificationChannelId = guildConfig?.channels?.taskVerification;
    if (verificationChannelId) {
        try {
            const adminChannel = await interaction.client.channels.fetch(verificationChannelId);
            if (adminChannel && adminChannel.isTextBased()) {
                const suppressMentions = await isMentionSuppressed(services.guilds, interaction.guildId);
                const rejectionMessage = `❌ <@${reviewerId}> rejected submission for **${updated?.taskName ?? `Task ${updated?.taskEventId}`}** by <@${updated?.userId}>. Reason: ${reason || "No reason provided"}. Submission moved to archive channel.`;
                if (suppressMentions) {
                    await (adminChannel as TextChannel).send(withSuppressedMentions({ content: rejectionMessage }, true));
                } else {
                    await (adminChannel as TextChannel).send(rejectionMessage);
                }
            }
        } catch (err) {
            console.warn(`[TaskInteractions] Failed to notify task admins in channel ${verificationChannelId}:`, err);
        }
    } else {
        console.warn(`[TaskInteractions] Task verification channel not configured for guild ${services.guildId}.`);
    }

}
