import { ButtonInteraction, StringSelectMenuInteraction, Message, Client, ModalSubmitInteraction, StringSelectMenuBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, TextChannel } from 'discord.js';
import type { Interaction } from 'discord.js';
import { createSubmission, completeSubmission, getPendingSubmission, updateSubmissionStatus } from './TaskService';
import { SubmissionStatus } from '../../models/TaskSubmission';

// STEP 1: "Submit Screenshot" button clicked on task embed
export async function handleSubmitButton(interaction: ButtonInteraction) {
    const taskId = interaction.customId.split('-')[2];
    if (!taskId) {
        await interaction.reply({ content: "Task ID missing from interaction.", flags: 1 << 6 });
        return;
    }
    const submission = createSubmission(interaction.user.id, taskId);

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select-task-${submission.id}`)
        .setPlaceholder('Select the active task')
        .addOptions([
            {
                label: `Task ${taskId}`,
                value: taskId,
                description: 'Selected task from the weekly event.'
            }
        ]);

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
    const submissionId = interaction.customId.split('-')[2];

    await interaction.reply({
        content: `Thank you for confirming. Now upload your screenshot for Task ${interaction.values[0]} and include any notes/comments in the same message.`,
        flags: 64
    });
}

// STEP 3: User sends screenshot + notes in DM
export async function handleDirectMessage(message: Message, client: Client) {
    if (message.author.bot || message.channel.type !== 1) return;

    const pending = getPendingSubmission(message.author.id);
    if (!pending) return;

    const attachment = message.attachments.first();
    if (!attachment) {
        await message.reply("Please upload a screenshot as an attachment.");
        return;
    }

    const notes = message.content.trim() || undefined;

    await completeSubmission(client, pending.id, attachment.url, notes);
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
        await updateSubmissionStatus(interaction.client, submissionId, SubmissionStatus.Approved, reviewerId);
        const taskId = interaction.message?.embeds[0]?.fields?.find(f => f.name.toLowerCase().includes('task id'))?.value || 'Unknown Task';
        await interaction.update({
            content: `<@${reviewerId}> approved submission for Task ${taskId} by ${interaction.message.embeds[0]?.fields[0]?.value}`,
            embeds: [],
            components: []
        });
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
                        .setRequired(true)
                )
            );
        await interaction.showModal(modal);
    }
}

// STEP 5: Modal submit for rejection reason
export async function handleRejectionModal(interaction: ModalSubmitInteraction) {
    const submissionId = interaction.customId.split('_')[2];
    if (!submissionId) {
        await interaction.reply({ content: "Subbmision ID missing from interaction.", flags: 1 << 6 });
        return;
    }
    const reviewerId = interaction.user.id;
    const reason = interaction.fields.getTextInputValue('reason');

    const updated = await updateSubmissionStatus(interaction.client, submissionId, SubmissionStatus.Rejected, reviewerId, reason);

    const taskId = interaction.message?.embeds[0]?.fields?.find(f => f.name.toLowerCase().includes('task id'))?.value || 'Unknown Task';
    await interaction.reply({
        content: `<@${reviewerId}> rejected submission for Task ${taskId} by <@${updated?.userId}>.`,
        flags: 1 << 6
    });
}

// Main interaction router
export async function handleTaskInteraction(interaction: Interaction, client: Client) {
    if (interaction.isButton()) {
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