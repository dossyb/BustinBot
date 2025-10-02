import { ButtonInteraction, StringSelectMenuInteraction, Message, Client, ModalSubmitInteraction, StringSelectMenuBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, TextChannel } from 'discord.js';
import type { Interaction } from 'discord.js';
import { createSubmission, completeSubmission, getPendingSubmission, updateSubmissionStatus, setPendingTask, consumePendingTask } from './TaskService';
import { SubmissionStatus } from '../../models/TaskSubmission';
import { handleTaskFeedback } from './HandleTaskFeedback';

// STEP 1: "Submit Screenshot" button clicked on task embed
export async function handleSubmitButton(interaction: ButtonInteraction) {
    const taskId = interaction.customId.split('-')[2];
    if (!taskId) {
        await interaction.reply({ content: "Task ID missing from interaction.", flags: 1 << 6 });
        return;
    }

    // TODO: Fetch active tasks from database
    const activeTasks = [taskId];
    const userId = interaction.user.id;

    if (activeTasks.length === 1) {
        const onlyTaskId = activeTasks[0];
        if (!onlyTaskId) {
            await interaction.reply({
                content: "Could not identify the active task.",
                flags: 1 << 6
            });
            return;
        }
        setPendingTask(userId, onlyTaskId);
        // Directly prompt for screenshot
        await interaction.user.send(
            `Please upload your screenshot for Task ${taskId} and include any notes/comments in the same message.`
        );

        await interaction.reply({
            content: 'Check your DMs to submit your screenshot!',
            flags: 1 << 6
        });

        return;
    }

    // Multiple active tasks -> show dropdown
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select-task-${taskId}-${interaction.user.id}`)
        .setPlaceholder('Select the active task')
        .addOptions(
            activeTasks.map(t => ({
                label: `Task ${t}`,
                value: t,
                description: 'Active weekly task'
            }))
        );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.user.send({
        content: 'Please confirm the task you are submitting for:',
        components: [row]
    });

    await interaction.reply({
        content: 'Check your DMs to submit your screenshot!',
        flags: 1 << 6
    });
}

// STEP 2: User confirms task from select menu
export async function handleTaskSelect(interaction: StringSelectMenuInteraction) {
    const [, taskId, userId] = interaction.customId.split('-');

    if (!taskId || !userId) {
        await interaction.reply({
            content: "Task ID or User ID missing from selection.",
            flags: 1 << 6
        });
        return;
    }

    const selectedTaskId = interaction.values[0]
    if (!selectedTaskId) {
        await interaction.reply({
            content: "No task selected.",
            flags: 1 << 6
        });
        return;
    }

    const submission = createSubmission(userId, selectedTaskId);

    await interaction.reply({
        content: `Thank you for confirming. Now upload your screenshot for Task ${interaction.values[0]} and include any notes/comments in the same message.`,
        flags: 64
    });
}

// STEP 3: User sends screenshot + notes in DM
export async function handleDirectMessage(message: Message, client: Client) {
    if (message.author.bot || message.channel.type !== 1) return;

    const taskEventId = consumePendingTask(message.author.id);
    const pending = taskEventId ? getPendingSubmission(message.author.id, taskEventId) : undefined;
    if (!pending && !taskEventId) return;

    const submission = pending ?? createSubmission(message.author.id, taskEventId!);

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

    await completeSubmission(client, submission.id, imageUrls.slice(0, 2), notes);
    await message.reply("✅ Submission received and sent for review!");
}

// STEP 4: Admin clicks Approve/Reject
export async function handleAdminButton(interaction: ButtonInteraction) {
    const [action, submissionId] = interaction.customId.split('_');
    if (!submissionId) {
        await interaction.reply({ content: "Submission ID missing from interaction.", flags: 1 << 6 });
        return;
    }
    const reviewerId = interaction.user.id;

    if (action === 'approve') {
        await interaction.deferReply({ flags: 1 << 6 });

        const submission = await updateSubmissionStatus(interaction.client, submissionId, SubmissionStatus.Approved, reviewerId);
        await interaction.editReply({ content: "✅ Submission approved and archived." });

        const channel = interaction.channel as TextChannel;
        await channel.send(`✅ <@${reviewerId}> approved submission for Task ${submission?.taskEventId} by ${interaction.message.embeds[0]?.fields[0]?.value}. Submission moved to archive channel.`);
    }

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
    }
}

// STEP 5: Modal submit for rejection reason
export async function handleRejectionModal(interaction: ModalSubmitInteraction) {
    // Acknowledge the modal submission ephemerally
    await interaction.deferReply({ flags: 1 << 6 });

    const reviewerId = interaction.user.id;
    const reason = interaction.fields.getTextInputValue('reason');
    const submissionId = interaction.customId.split('_')[2];
    if (!submissionId) {
        await interaction.reply({ content: "Subbmision ID missing from interaction.", flags: 1 << 6 });
        return;
    }

    const updated = await updateSubmissionStatus(interaction.client, submissionId, SubmissionStatus.Rejected, reviewerId, reason);

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
            `❌ <@${reviewerId}> rejected submission for Task ${updated?.taskEventId} by <@${updated?.userId}>. Reason: ${reason || "No reason provided"}. Submission moved to archive channel.`
        );
    }

}

// Main interaction router
export async function handleTaskInteraction(interaction: Interaction, client: Client) {
    if (interaction.isButton()) {
        if (interaction.customId.startsWith('task-feedback-')) {
            return await handleTaskFeedback(interaction);
        }

        if (interaction.customId.startsWith("task-submit-")) {
            await handleSubmitButton(interaction);
        } else if (
            interaction.customId.startsWith("approve_") ||
            interaction.customId.startsWith("reject_")
        ) {
            await handleAdminButton(interaction);
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith("select-task-")) {
            await handleTaskSelect(interaction);
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith("reject_reason_")) {
            await handleRejectionModal(interaction);
        }
    }
}