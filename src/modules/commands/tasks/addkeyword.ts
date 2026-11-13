import { SlashCommandBuilder, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";

const addkeyword: Command = {
    name: "addkeyword",
    description: "Add a new keyword to the keyword pool.",
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin],

    slashData: new SlashCommandBuilder()
        .setName("addkeyword")
        .setDescription("Add a new keyword to the keyword pool.")
        .addStringOption(opt =>
            opt
                .setName("word")
                .setDescription('The keyword to add (e.g. "bustinbot")')
                .setRequired(true)
        ),

    async execute({ interaction, services }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const repo = services.repos.keywordRepo;

        const word = interaction.options.getString("word", true).trim();
        const existing = await repo.getKeywordById(
            word.toLowerCase().replace(/\s+/g, "_").replace(/[^\w_]/g, "")
        );

        if (existing) {
            await interaction.editReply({
                content: `The keyword **"${word}"** already exists in the database.`,
            });
            return;
        }

        try {
            await repo.addKeyword(word);
            await interaction.editReply({
                content: `Keyword **"${word}"** has been added successfully!`,
            });
        } catch (err) {
            console.error("[AddKeyword] Failed to add keyword:", err);
            await interaction.editReply({
                content: "Failed to add keyword. Check logs for details.",
            });
        }
    },
};

export default addkeyword;