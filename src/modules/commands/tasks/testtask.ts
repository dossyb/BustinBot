import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { sample } from "es-toolkit";
import { DateTime } from "luxon";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { buildTaskEventEmbed } from "../../tasks/TaskEmbeds.js";
import type { TaskEvent } from "../../../models/TaskEvent.js";
import { TaskCategory } from "../../../models/Task.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";

const testtask: Command = {
    name: "testtask",
    description: "Post a fake task event for testing the submission flow.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("testtask")
        .setDescription("Post a fake task event for testing."),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const taskData = await services.tasks.getAllTasks();

        if (!taskData.length) {
            await interaction.editReply({ content: "No tasks available." });
            return;
        }
        const randomTask = sample(taskData);
        const selectedAmount = randomTask.amounts?.length ? sample(randomTask.amounts) : undefined;


        // Fake task event data
        const now = DateTime.utc();
        const taskEventId = `test-${randomTask.id}-${now.toMillis()}`;

        const baseEvent = {
            id: taskEventId,
            task: randomTask,
            category: TaskCategory.PvM,
            keyword: "pineapple",
            amounts: {
                bronze: randomTask.amtBronze ?? 0,
                silver: randomTask.amtSilver ?? 0,
                gold: randomTask.amtGold ?? 0,
            },
            startTime: now.toJSDate(),
            endTime: now.plus({ weeks: 1 }).toJSDate(),
            createdAt: now.toJSDate(),
        }

        const event: TaskEvent = selectedAmount !== undefined
            ? { ...baseEvent, selectedAmount }
            : baseEvent;

        const channel = interaction.channel;
        if (!channel?.isSendable()) {
            await interaction.editReply({
                content: "Test task events can only be posted in a channel the bot can send to.",
            });
            return;
        }
        const { embeds, components } = buildTaskEventEmbed(event);

        await channel.send({ embeds, components });
        await services.taskEvents.storeTaskEvent(event);
        await interaction.editReply({ content: "Test task event posted!" });
    },
};

export default testtask;
