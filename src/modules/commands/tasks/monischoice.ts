import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, LabelBuilder, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { MONIS_CHOICE_MODAL, runningTaskWeek } from "../../tasks/HandleMonisChoiceModal.js";

const monischoice: Command = {
    name: "monischoice",
    description: "Post or update this week's Moni's Choice task.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin, CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("monischoice")
        .setDescription("Post or update this week's Moni's Choice task."),

    async execute({ interaction, services }) {
        if (!interaction) return;

        const { regularEvents, monisChoice } = await runningTaskWeek(services.repos.taskRepo);
        if (!regularEvents.length) {
            await interaction.reply({
                content: "There are no weekly tasks running for Moni's Choice to end with.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const taskName = new TextInputBuilder().setCustomId("taskName").setStyle(TextInputStyle.Short);
        const description = new TextInputBuilder().setCustomId("description").setStyle(TextInputStyle.Paragraph);
        const bronze = new TextInputBuilder().setCustomId("bronze").setStyle(TextInputStyle.Short);
        const silver = new TextInputBuilder().setCustomId("silver").setStyle(TextInputStyle.Short);
        const gold = new TextInputBuilder().setCustomId("gold").setStyle(TextInputStyle.Short);
        const task = monisChoice?.task;
        if (task) {
            taskName.setValue(task.taskName);
            if (task.description) description.setValue(task.description);
            bronze.setValue(`${task.amtBronze}`);
            silver.setValue(`${task.amtSilver}`);
            gold.setValue(`${task.amtGold}`);
        }

        const modal = new ModalBuilder()
            .setCustomId(MONIS_CHOICE_MODAL)
            .setTitle(monisChoice ? "Update Moni's Choice" : "New Moni's Choice")
            .addLabelComponents(
                new LabelBuilder().setLabel("Task Name").setTextInputComponent(taskName),
                new LabelBuilder().setLabel("Description").setTextInputComponent(description),
                new LabelBuilder().setLabel("Bronze Amount").setTextInputComponent(bronze),
                new LabelBuilder().setLabel("Silver Amount").setTextInputComponent(silver),
                new LabelBuilder().setLabel("Gold Amount").setTextInputComponent(gold)
            );

        await interaction.showModal(modal);
    },
};

export default monischoice;
