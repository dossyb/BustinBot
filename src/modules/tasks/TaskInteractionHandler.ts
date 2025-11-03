import type { Interaction, Client } from "discord.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { handleTaskFeedback } from "./HandleTaskFeedback.js";
import {
    handleSubmitButton,
    handleAdminButton,
    handleTaskSelect,
    handleRejectionModal,
} from "./TaskInteractions.js";
import { handleUpdateTaskModal } from "./HandleUpdateTaskModal.js";
import { setupService } from "../../core/services/SetupService.js";

export async function handleTaskInteraction(
    interaction: Interaction,
    _client: Client,
    services: ServiceContainer
) {
    if (interaction.isButton()) {
        if (interaction.customId.startsWith("task-feedback|")) {
            return handleTaskFeedback(interaction, services.tasks.repository);
        }

        if (interaction.customId.startsWith("task-submit-")) {
            await handleSubmitButton(interaction, services);
        } else if (
            interaction.customId.startsWith("approve_") ||
            interaction.customId.startsWith("reject_")
        ) {
            await handleAdminButton(interaction, services);
        }

        const userId = interaction.user.id;
        if (interaction.customId === "tasksetup_confirm") {
            const selections = setupService.getSelections("task", userId);
            const missing = setupService.getMissingFields("task", selections);

            if (missing.length) {
                await interaction.reply({
                    content: `Please select: ${missing.join(", ")} before confirming.`,
                    flags: 1 << 6,
                });
                return;
            }

            await setupService.persist("task", services.guilds, interaction.guildId!, selections!);
            setupService.clearSelections("task", userId);

            await interaction.update({
                content: "Task module setup complete! Task roles and channels have been saved.",
                components: [],
            });
            return;
        }

        if (interaction.customId === "tasksetup_cancel") {
            setupService.clearSelections("task", userId);
            await interaction.update({
                content: "Task setup cancelled. No changes were made.",
                components: [],
            });
            return;
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith("select-task-")) {
            await handleTaskSelect(interaction, services);
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith("reject_reason_")) {
            await handleRejectionModal(interaction, services);
        }
        if (interaction.customId.startsWith("update_task_modal_")) {
            await handleUpdateTaskModal(interaction, services);
        }
    }

    if (interaction.isRoleSelectMenu()) {
        const userId = interaction.user.id;
        switch (interaction.customId) {
            case "tasksetup_admin_role":
                setupService.setSelection("task", userId, "taskAdmin", interaction.values[0] ?? "");
                break;
            case "tasksetup_user_role":
                setupService.setSelection("task", userId, "taskUser", interaction.values[0] ?? "");
                break;
            default:
                return;
        }

        await interaction.deferUpdate();
    }

    if (interaction.isChannelSelectMenu()) {
        const userId = interaction.user.id;
        switch (interaction.customId) {
            case "tasksetup_channel":
                setupService.setSelection("task", userId, "taskChannel", interaction.values[0] ?? "");
                break;
            case "tasksetup_verification_channel":
                setupService.setSelection("task", userId, "taskVerification", interaction.values[0] ?? "");
                break;
            default:
                return;
        }

        await interaction.deferUpdate();
    }
}
