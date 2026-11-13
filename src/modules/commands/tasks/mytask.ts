import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { DateTime } from "luxon";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { SubmissionStatus } from "../../../models/TaskSubmission.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import type { TaskEvent } from "../../../models/TaskEvent.js";
import { TaskCategory } from "../../../models/Task.js";

const mytask: Command = {
    name: "mytask",
    description: "Check the status of your task submissions",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.Everyone],
    usage: "/mytask [task_event]",
    examples: [
        "/mytask",
        "/mytask task_event:PVM054-20260126"
    ],

    slashData: new SlashCommandBuilder()
        .setName("mytask")
        .setDescription("Check the status of your task submissions")
        .addStringOption(option =>
            option.setName("task_event")
                .setDescription("Select a specific task event (optional)")
                .setRequired(false)
                .addChoices(
                    { name: "Current PvM Task", value: "current_pvm" },
                    { name: "Current Skilling Task", value: "current_skilling" },
                    { name: "Current Minigame/Misc Task", value: "current_minigame" },
                    { name: "Current Leagues Task", value: "current_leagues" }
                )
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction; services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const userId = interaction.user.id;
        const taskEventChoice = interaction.options.getString("task_event");
        const taskRepo = services.repos.taskRepo;

        try {
            const now = new Date();

            // Get active task events
            const activeEvents = await taskRepo.getTaskEventsBetween(
                DateTime.fromJSDate(now).minus({ days: 30 }).toJSDate(),
                DateTime.fromJSDate(now).plus({ days: 30 }).toJSDate()
            );

            const currentlyActive = activeEvents
                .filter((event: TaskEvent) => {
                    return event.startTime <= now && event.endTime > now;
                });

            if (currentlyActive.length === 0) {
                await interaction.editReply({
                    content: "There are no active task events at the moment.",
                });
                return;
            }

            let submissions;
            let selectedEvent: TaskEvent | undefined;

            if (taskEventChoice) {
                // Map choice to category
                const categoryMap: Record<string, TaskCategory> = {
                    "current_pvm": TaskCategory.PvM,
                    "current_skilling": TaskCategory.Skilling,
                    "current_minigame": TaskCategory.MinigameMisc,
                    "current_leagues": TaskCategory.Leagues
                };

                const targetCategory = categoryMap[taskEventChoice];
                selectedEvent = currentlyActive.find(e => e.category === targetCategory);

                if (!selectedEvent) {
                    await interaction.editReply({
                        content: `There is no active ${targetCategory} task event at the moment.`,
                    });
                    return;
                }

                // Get submissions for specific task event
                const allSubmissions = await taskRepo.getSubmissionsForTask(selectedEvent.id);
                submissions = allSubmissions.filter(s => s.userId === userId);

                if (submissions.length === 0) {
                    await interaction.editReply({
                        content: `You have no submissions for the current ${targetCategory} task event.`,
                    });
                    return;
                }
            } else {
                // Get all submissions for this user
                const allUserSubmissions = await taskRepo.getSubmissionsByUser(userId);
                
                // Filter to only active task events
                const activeEventIds = currentlyActive.map(e => e.id);
                submissions = allUserSubmissions.filter(s => activeEventIds.includes(s.taskEventId));

                if (submissions.length === 0) {
                    await interaction.editReply({
                        content: "You have no submissions for currently active task events.",
                    });
                    return;
                }

                // Sort by most recent first
                submissions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            }

            const statusLines = submissions.map(sub => {
                const taskName = sub.taskName || "Unknown Task";
                let statusText = "";

                switch (sub.status) {
                    case SubmissionStatus.Bronze:
                        statusText = "**Approved for Bronze** 🥉";
                        break;
                    case SubmissionStatus.Silver:
                        statusText = "**Approved for Silver** 🥈";
                        break;
                    case SubmissionStatus.Gold:
                        statusText = "**Approved for Gold** 🥇";
                        break;
                    case SubmissionStatus.Approved:
                        statusText = "**Approved** ✅";
                        break;
                    case SubmissionStatus.Pending:
                        statusText = "**Pending** ⏳";
                        break;
                    case SubmissionStatus.Rejected:
                        statusText = "**Rejected** ❌";
                        break;
                    default:
                        statusText = "**Unknown**";
                }

                return `• ${taskName}: ${statusText}`;
            });


            const replyText = taskEventChoice
                ? `**Task Submission Status:**\n\n${statusLines.join("\n")}`
                : `**Your Active Task Submissions:**\n\n${statusLines.join("\n")}`;

            await interaction.editReply({ content: replyText });
        } catch (error) {
            console.error("[MyTask] Error fetching submissions:", error);
            await interaction.editReply({ content: "Failed to fetch your task submissions." });
        }
    }
};

export default mytask;