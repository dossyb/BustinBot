import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { Command } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { importTasksFromCsv } from "../../../scripts/importTasksFromCSV.js";

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

    async execute({ interaction, services }: { interaction?: ChatInputCommandInteraction, services?: ServiceContainer }) {
        if (!interaction) return;
        await interaction.deferReply({ flags: 1 << 6 });

        const attachment = interaction.options.getAttachment("file");
        if (!attachment || !attachment.name.toLowerCase().endsWith(".csv")) {
            await interaction.editReply({ content: "Please upload a valid CSV file." });
            return;
        }

        const res = await fetch(attachment.url);
        const buffer = Buffer.from(await res.arrayBuffer());
        const tempPath = path.join("/tmp", `tasks-${Date.now()}.csv`);
        fs.writeFileSync(tempPath, buffer);

        try {
            const guildId = interaction.guildId!;
            const result = await importTasksFromCsv(guildId, tempPath);

            await interaction.editReply({
                content: `✅ Import complete.\n• ${result.newCount} new tasks added\n• ${result.skipped} skipped (existing)\n• ${result.total} total in file.`,
            });
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: "Import failed. Check logs for details." });
        } finally {
            fs.unlinkSync(tempPath);
        }
    }
};

export default importtasks;
