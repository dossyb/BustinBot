import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { Command } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { importTasks, parseTasksCsv } from "../../tasks/TaskImport.js";

const importtasks: Command = {
    name: "importtasks",
    description: "Import new tasks from a CSV file (existing tasks will be ignored).",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("importtasks")
        .setDescription("Import new tasks from a CSV file.")
        .addAttachmentOption((option) =>
            option.setName("file").setDescription("CSV file to import").setRequired(true)
        ),

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const attachment = interaction.options.getAttachment("file");
        if (!attachment || !attachment.name.toLowerCase().endsWith(".csv")) {
            await interaction.editReply({ content: "Please upload a valid CSV file." });
            return;
        }

        try {
            const res = await fetch(attachment.url);
            if (!res.ok) {
                throw new Error(`Failed to download ${attachment.name}: HTTP ${res.status}`);
            }

            const result = await importTasks(services.tasks, parseTasksCsv(await res.text()));

            await interaction.editReply({
                content: `✅ Import complete.\n• ${result.newCount} new tasks added\n• ${result.skipped} skipped (existing)\n• ${result.total} total in file.`,
            });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: "Import failed. Check logs for details." });
        }
    }
};

export default importtasks;
