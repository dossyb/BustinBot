import { MessageFlags, type Interaction } from "discord.js";
import type { ServiceContainer } from "../../core/services/ServiceContainer.js";
import { handleTaskFeedback } from "./HandleTaskFeedback.js";
import {
    handleSubmitButton,
    handleAdminButton,
    handleRejectionModal,
} from "./TaskInteractions.js";
import { handleUpdateTaskModal } from "./HandleUpdateTaskModal.js";
import { buildLeaderboardMessage } from "./TaskLeaderboards.js";
import { handleTaskPollVoteInteraction } from "./HandleTaskPoll.js";
import { TASK_LIST_BUTTON, buildTaskListPage, taskListButtonCategory } from "./TaskList.js";
import { buttonPage } from "../../utils/Pagination.js";
import { NEW_TASK_MODAL, handleNewTaskModal } from "./HandleNewTaskModal.js";
import { MONIS_CHOICE_MODAL, handleMonisChoiceModal } from "./HandleMonisChoiceModal.js";

export async function handleTaskInteraction(
    interaction: Interaction,
    services: ServiceContainer
) {
    if (interaction.isButton()) {
        if (interaction.customId.startsWith("vote_")) {
            await handleTaskPollVoteInteraction(interaction, services);
            return;
        }

        if (interaction.customId.startsWith(TASK_LIST_BUTTON)) {
            const { customId } = interaction;
            await interaction.deferUpdate();
            await interaction.editReply(await buildTaskListPage(services, taskListButtonCategory(customId), buttonPage(customId)));
            return;
        }

        if (interaction.customId.startsWith("task-feedback|") || interaction.customId.startsWith("task-feedback-")) {
            return handleTaskFeedback(interaction, services.tasks);
        }

        if (interaction.customId.startsWith("task-leaderboard|")) {
            const [, view] = interaction.customId.split("|");
            const targetView = view === "periodic" ? "periodic" : "lifetime";
            try {
                await interaction.deferUpdate();
                const payload = await buildLeaderboardMessage(services, targetView, interaction.user.id, {
                    client: interaction.client,
                    guild: interaction.guild,
                });
                await interaction.editReply(payload);
            } catch (err) {
                console.error("[TaskInteractions] Failed to build the leaderboard:", err);
                try {
                    await interaction.editReply({
                        content: "Leaderboard initialisation failed. Please use /reportbug if it continues.",
                        components: [],
                    });
                } catch (updateErr) {
                    console.warn("[TaskInteractions] Failed to update leaderboard interaction:", updateErr);
                }
            }
            return;
        }

        if (interaction.customId.startsWith("task-submit-")) {
            await handleSubmitButton(interaction, services);
        } else if (
            interaction.customId.startsWith("approve_") ||
            interaction.customId.startsWith("reject_") ||
            interaction.customId.startsWith("review-confirm|") ||
            interaction.customId.startsWith("review-cancel|")
        ) {
            await handleAdminButton(interaction, services);
        }

        const userId = interaction.user.id;
        if (interaction.customId === "tasksetup_confirm") {
            const selections = services.setup.getSelections("task", userId);
            const missing = services.setup.getMissingFields("task", selections);

            if (!selections || missing.length) {
                await interaction.reply({
                    content: `Please select: ${missing.join(", ")} before confirming.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            await services.setup.persist("task", services.guilds, services.guildId, selections);
            services.setup.clearSelections("task", userId);

            await interaction.update({
                content: "Task module setup complete! Task roles and channels have been saved.",
                components: [],
            });
            return;
        }

        if (interaction.customId === "tasksetup_cancel") {
            services.setup.clearSelections("task", userId);
            await interaction.update({
                content: "Task setup cancelled. No changes were made.",
                components: [],
            });
            return;
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "tasksetup_period_events") {
            const userId = interaction.user.id;
            const selection = interaction.values[0];
            if (selection) {
                services.setup.setSelection("task", userId, "taskPeriodEvents", selection);
            }
            await interaction.deferUpdate();
            return;
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith("reject_reason_")) {
            await handleRejectionModal(interaction, services);
        }
        if (interaction.customId.startsWith("update_task_modal_")) {
            await handleUpdateTaskModal(interaction, services);
        }
        if (interaction.customId.startsWith(NEW_TASK_MODAL)) {
            await handleNewTaskModal(interaction, services);
        }
        if (interaction.customId === MONIS_CHOICE_MODAL) {
            await handleMonisChoiceModal(interaction, services);
        }
    }

    if (interaction.isRoleSelectMenu()) {
        const userId = interaction.user.id;
        switch (interaction.customId) {
            case "tasksetup_admin_role":
                services.setup.setSelection("task", userId, "taskAdmin", interaction.values[0] ?? "");
                break;
            case "tasksetup_user_role":
                services.setup.setSelection("task", userId, "taskUser", interaction.values[0] ?? "");
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
                services.setup.setSelection("task", userId, "taskChannel", interaction.values[0] ?? "");
                break;
            case "tasksetup_verification_channel":
                services.setup.setSelection("task", userId, "taskVerification", interaction.values[0] ?? "");
                break;
            default:
                return;
        }

        await interaction.deferUpdate();
    }
}
