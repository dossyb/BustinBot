import { ButtonInteraction, Message, Client, ModalSubmitInteraction, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { SubmissionStatus } from "../../models/TaskSubmission.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { getTaskDisplayName, submissionLabel, TIER_DISPLAY } from "./TaskEmbeds.js";
import { getTierPoints, incrementLifetimePoints, incrementPeriodicPoints } from "./TaskLeaderboards.js";
import { applyTaskMilestoneRoles } from "./TaskMilestones.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../utils/MentionUtils.js";
import { configuredChannel } from "../../utils/ChannelUtils.js";

function alreadyReviewedReply(status: string | undefined): string {
    return `⚠️ This submission has already been reviewed (${status}). Another admin may have processed it.`;
}

function archivedEnding(archived: boolean): string {
    return archived ? " and archived." : ". It couldn't be archived; check the logs.";
}

// STEP 1: "Submit Screenshot" button clicked on task embed
export async function handleSubmitButton(interaction: ButtonInteraction, services: ServiceContainer) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const parts = interaction.customId.split("-");
    const taskEventId = parts.slice(2).join("-");

    if (!taskEventId) {
        await interaction.editReply({ content: "Task ID missing from interaction." });
        return;
    }

    const taskRepo = services.repos.taskRepo;

    const taskEvent = await taskRepo.getTaskEventById(taskEventId);
    if (!taskEvent) {
        await interaction.editReply({
            content: "That task is no longer active. Please check the latest task announcement.",
        });
        return;
    }

    const taskName = getTaskDisplayName(taskEvent.task, taskEvent.selectedAmount);
    const userId = interaction.user.id;

    await services.tasks.setPendingTask(userId, taskEventId);

    try {
        await interaction.user.send(
            `Please upload your screenshot(s) for **${taskName}** and include any notes/comments in the same message.`
        );
        await interaction.editReply({
            content: `Check your DMs to submit your screenshot(s) for **${taskName}**!`,
        });
    } catch {
        await services.tasks.consumePendingTask(userId);
        await interaction.editReply({
            content: "I couldn't send you a DM. Please enable direct messages from server members and try again."
        });
    }
}

// STEP 3: User sends screenshot + notes in DM
export async function handleDirectMessage(message: Message, client: Client, services: ServiceContainer) {
    if (message.author.bot || message.channel.type !== 1) return;

    const taskEventId = await services.tasks.peekPendingTask(message.author.id);
    if (!taskEventId) return;

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

    try {
        const outcome = await services.tasks.completeSubmission(client, message.author.id, taskEventId, imageUrls, services, message.content.trim() || undefined);
        switch (outcome.result) {
            case "submitted": {
                const { taskName, screenshotUrls } = outcome.submission;
                await message.reply(`✅ Submission for **${taskName ?? "your task"}** received with ${screenshotUrls.length} screenshot${screenshotUrls.length === 1 ? "" : "s"} and sent for review!`);
                break;
            }
            case "taskNotFound":
                await message.reply("Couldn't locate the task details. Please try submitting again or contact a Task Admin.");
                break;
            case "adminsUnreachable":
                await message.reply("I couldn't pass your submission on to the Task Admins just now. Please send it again later, or contact a Task Admin.");
                break;
            case "alreadySubmitted":
                await message.reply("I've already received your submission for this task. To send another, click Submit on the task again.");
                break;
        }
    } catch (err) {
        console.error("[TaskDM] Failed to store submission:", err);
        await message.reply("Something went wrong saving your submission. Please send it again.");
    }
}

// STEP 4: Admin clicks Approve/Reject
export async function handleAdminButton(interaction: ButtonInteraction, services: ServiceContainer) {
    const customId = interaction.customId;

    // Second-step cancel action from confirmation prompt
    if (customId.startsWith("review-cancel|")) {
        await interaction.update({
            content: "Review action cancelled. No changes were made.",
            components: [],
        });
        return;
    }

    // Second-step confirm action from confirmation prompt
    if (customId.startsWith("review-confirm|")) {
        const parts = customId.split("|");
        const confirmAction = parts[1];
        const maybeTier = parts[2];
        const submissionId = parts.slice(3).join("|").trim();

        if (!confirmAction || !submissionId) {
            await interaction.update({
                content: "Invalid confirmation payload. Please try again.",
                components: [],
            });
            return;
        }

        if (confirmAction === "reject") {
            const modal = new ModalBuilder()
                .setCustomId(`reject_reason_${submissionId}`)
                .setTitle("Reject Submission")
                .addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(
                        new TextInputBuilder()
                            .setCustomId("reason")
                            .setLabel("Rejection Reason")
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(false)
                    )
                );
            await interaction.showModal(modal);
            return;
        }

        const tier = maybeTier as "bronze" | "silver" | "gold";
        const validTiers = ["bronze", "silver", "gold"];

        if (!validTiers.includes(tier)) {
            await interaction.update({
                content: "Invalid tier selected for approval.",
                components: [],
            });
            return;
        }

        const taskRepo = services.repos.taskRepo;

        await interaction.deferUpdate();
        await interaction.editReply({
            content: `⏳ Processing approval...`,
            components: [],
        });

        const currentSubmission = await taskRepo.getSubmissionById(submissionId);
        if (!currentSubmission) {
            await interaction.editReply({
                content: "Submission not found.",
                components: [],
            });
            return;
        }

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
                const reviewed = await taskRepo.getSubmissionById(submissionId);
                await interaction.editReply({ content: alreadyReviewedReply(reviewed?.status) });
                return;
            }

            const points = getTierPoints(tier);
            const previousPoints = result.previousTierPoints ?? 0;
            const deltaPoints = Math.max(0, points - previousPoints);

            if (deltaPoints > 0) {
                await incrementLifetimePoints(services, result.userId, deltaPoints);
                await incrementPeriodicPoints(services, result.userId, deltaPoints, result.taskEventId, tier, result.previousStatus);
            }

            await applyTaskMilestoneRoles(interaction.client, services, result.userId);

            const formattedTier = tier.charAt(0).toUpperCase() + tier.slice(1);
            const kept = deltaPoints > 0 ? undefined : result.previousStatus && TIER_DISPLAY[result.previousStatus];
            const suppressMentions = await isMentionSuppressed(services.guilds, interaction.guildId);
            const approvalMessage = kept
                ? `✅ <@${reviewerId}> approved **${formattedTier} tier** for submission by <@${result.userId}> on **${submissionLabel(result)}**. They already hold ${kept.emoji} ${kept.name} for this task, so nothing changed.`
                : `✅ <@${reviewerId}> approved **${formattedTier} tier** for submission by <@${result.userId}> on **${submissionLabel(result)}** (${result.prizeRolls ?? 0} roll${(result.prizeRolls ?? 0) > 1 ? "s" : ""}).`;
            if (interaction.channel?.isSendable()) {
                if (suppressMentions) {
                    await interaction.channel.send(withSuppressedMentions({ content: approvalMessage }, true));
                } else {
                    await interaction.channel.send(approvalMessage);
                }
            }

            await interaction.editReply({
                content: kept
                    ? `✅ Submission approved for **${formattedTier} tier**${archivedEnding(result.archived)} The member already holds ${kept.emoji} ${kept.name} for this task, so their tier is unchanged.`
                    : `✅ Submission approved for **${formattedTier} tier** (${result.prizeRolls ?? 0} roll${(result.prizeRolls ?? 0) > 1 ? "s" : ""})${archivedEnding(result.archived)}`,
                components: []
            });
        } catch (err) {
            console.error("[TaskInteractions] Tier approval failed:", err);
            await interaction.editReply({ content: "❌ Failed to process tier approval. Check logs for details." });
        }

        return;
    }

    let action: string | undefined;
    let submissionId: string | undefined;
    let maybeTier: string | undefined;

    if (customId.startsWith("reject_")) {
        action = "reject";
        submissionId = customId.slice("reject_".length).trim();
    } else if (customId.startsWith("approve_")) {
        action = "approve";
        const parts = customId.split("_");
        maybeTier = parts[1];
        submissionId = parts.slice(2).join("_").trim();
    }

    if (!submissionId) {
        await interaction.reply({ content: "Submission ID missing from interaction.", flags: MessageFlags.Ephemeral });
        return;
    }
    if (!action) {
        await interaction.reply({ content: "Unknown task action.", flags: MessageFlags.Ephemeral });
        return;
    }

    if (action === "reject") {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`review-confirm|reject||${submissionId}`)
                .setLabel("Confirm Reject")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`review-cancel|${submissionId}`)
                .setLabel("Cancel")
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: "Are you sure you want to reject this submission?",
            components: [row],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // Handle tier approvals
    const tier = maybeTier as "bronze" | "silver" | "gold";
    const validTiers = ["bronze", "silver", "gold"];

    if (action === "approve" && validTiers.includes(tier)) {
        const formattedTier = tier.charAt(0).toUpperCase() + tier.slice(1);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`review-confirm|approve|${tier}|${submissionId}`)
                .setLabel(`Confirm ${formattedTier}`)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`review-cancel|${submissionId}`)
                .setLabel("Cancel")
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: `Are you sure you want to approve this submission for **${formattedTier}** tier?`,
            components: [row],
            flags: MessageFlags.Ephemeral,
        });

        return;
    }
}

// STEP 5: Modal submit for rejection reason
export async function handleRejectionModal(interaction: ModalSubmitInteraction, services: ServiceContainer) {
    // Acknowledge the modal submission ephemerally
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reviewerId = interaction.user.id;
    const reason = interaction.fields.getTextInputValue("reason");
    const submissionId = interaction.customId.split("_")[2];
    if (!submissionId) {
        await interaction.editReply({ content: "Submission ID missing from interaction." });
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

    if (!updated) {
        const reviewed = await services.repos.taskRepo.getSubmissionById(submissionId);
        await interaction.editReply({
            content: reviewed ? alreadyReviewedReply(reviewed.status) : "Submission not found.",
        });
        return;
    }

    // Update the ephemeral reply
    await interaction.editReply({
        content: `❌ Submission rejected${archivedEnding(updated.archived)}`,
    });

    // Post a visible message in the admin channel
    const adminChannel = await configuredChannel(interaction.client, services, "taskVerification");
    if (adminChannel) {
        try {
            const suppressMentions = await isMentionSuppressed(services.guilds, interaction.guildId);
            const rejectionMessage = `❌ <@${reviewerId}> rejected submission for **${submissionLabel(updated)}** by <@${updated.userId}>. Reason: ${reason || "No reason provided"}.${updated.archived ? " Submission moved to archive channel." : ""}`;
            if (suppressMentions) {
                await adminChannel.send(withSuppressedMentions({ content: rejectionMessage }, true));
            } else {
                await adminChannel.send(rejectionMessage);
            }
        } catch (err) {
            console.warn(`[TaskInteractions] Failed to notify task admins in channel ${adminChannel.id}:`, err);
        }
    }

}
