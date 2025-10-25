import { ButtonInteraction, StringSelectMenuInteraction, Message, Client, ModalSubmitInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, TextChannel, ActionRowBuilder } from 'discord.js';
import { SubmissionStatus } from '../../models/TaskSubmission';
import type { ServiceContainer } from '../../core/services/ServiceContainer';
import { getTaskDisplayName } from './TaskEmbeds';
import { handleUpdateTaskModal } from './HandleUpdateTaskModal';

const MAX_SCREENSHOTS = 10;

// STEP 1: "Submit Screenshot" button clicked on task embed
export async function handleSubmitButton(interaction: ButtonInteraction, services: ServiceContainer) {
    const parts = interaction.customId.split('-');
    const taskEventId = parts.slice(2).join('-');

    if (!taskEventId) {
        await interaction.reply({ content: "Task ID missing from interaction.", flags: 1 << 6 });
        return;
    }

    const taskRepo = services.repos.taskRepo;
    if (!taskRepo) {
        await interaction.reply({ content: "Task repository unavailable.", flags: 1 << 6 });
        return;
    }

    const taskEvent = await taskRepo.getTaskEventById(taskEventId);
    if (!taskEvent) {
        await interaction.reply({
            content: "That task is no longer active. Please check the latest task announcement.",
            flags: 1 << 6
        });
        return;
    }

    const taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);
    const userId = interaction.user.id;

    services.tasks.setPendingTask(userId, taskEventId);
    try {
        await interaction.user.send(
            `Please upload your screenshot for **${taskName}** and include any notes/comments in the same message.`
        );
        await interaction.reply({
            content: `Check your DMs to submit your screenshot for **${taskName}**!`,
            flags: 1 << 6
        });
    } catch {
        services.tasks.consumePendingTask(userId);
        await interaction.reply({
            content: "I couldn't send you a DM. Please enable direct messages from server members and try again.",
            flags: 1 << 6
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
    const [action, maybeTier, submissionId] = interaction.customId.split('_');
    if (!submissionId) {
        await interaction.reply({ content: "Submission ID missing from interaction.", flags: 1 << 6 });
        return;
    }
    const reviewerId = interaction.user.id;

    if (action === 'reject') {
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

    // Handle tier approvals
    const tier = maybeTier as 'bronze' | 'silver' | 'gold';
    const validTiers = ['bronze', 'silver', 'gold'];

    if (action === 'approve' && validTiers.includes(tier)) {
        await interaction.deferReply({ flags: 1 << 6 });

        try {
            const result = await services.tasks.updateSubmissionTier(
                interaction.client,
                submissionId,
                tier,
                reviewerId
            );

            if (!result) {
                await interaction.editReply({ content: "⚠️ Could not update submission. It may already be at this or a higher tier." });
                return;
            }

            const channel = interaction.channel as TextChannel;
            const formattedTier = tier.charAt(0).toUpperCase() + tier.slice(1);
            await channel.send(
                `✅ <@${reviewerId}> approved **${formattedTier} tier** for submission by <@${result.userId}> on **${result.taskName ?? `Task ${result.taskEventId}`}** (${result.prizeRolls ?? 0} roll${(result.prizeRolls ?? 0) > 1 ? 's' : ''}).`
            );

            await interaction.editReply({
                content: `✅ Submission approved for **${formattedTier} tier** (${result.prizeRolls ?? 0} roll${(result.prizeRolls ?? 0) > 1 ? 's' : ''}) and archived.`
            });
        } catch (err) {
            console.error('[TaskInteractions] Tier approval failed:', err);
            await interaction.editReply({ content: "❌ Failed to process tier approval. Check logs for details." });
        }

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

    const updated = await services.tasks.updateSubmissionStatus(interaction.client, submissionId, SubmissionStatus.Rejected, reviewerId, reason);

    // Update the ephemeral reply
    await interaction.editReply({
        content: "❌ Submission rejected and archived."
    });

    // Post a visible message in the admin channel
    const adminChannel = interaction.client.channels.cache.find(
        (c): c is TextChannel => c.isTextBased() && "name" in c && c.name === "task-admin"
    );

    if (adminChannel) {
        await adminChannel.send(
            `❌ <@${reviewerId}> rejected submission for **${updated?.taskName ?? `Task ${updated?.taskEventId}`}** by <@${updated?.userId}>. Reason: ${reason || "No reason provided"}. Submission moved to archive channel.`
        );
    }

}
