import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import type { Command } from "models/Command";
import { CommandModule, CommandRole } from "models/Command";

const addkeyword: Command = {
    name: 'addkeyword',
    description: 'Add a new keyword to the keyword pool.',
    module: CommandModule.Task,
    allowedRoles: [CommandRole.TaskAdmin],

    slashData: new SlashCommandBuilder()
        .setName('addkeyword')
        .setDescription('Add a new keyword to the keyword pool.')
        .addStringOption(opt =>
            opt
                .setName('word')
                .setDescription('The keyword to add (e.g. "bustinbot")')
                .setRequired(true)
        ),

    async execute({ interaction, services }) {
        if (!interaction) return;

        const repo = services.repos?.keywordRepo;
        if (!repo) {
            await interaction.reply({
                content: "Keyword repository unavailable.",
                flags: 1 << 6,
            });
            return;
        }

        const word = interaction.options.getString("word", true).trim();
        const existing = await repo.getKeywordById(
            word.toLowerCase().replace(/\s+/g, "_").replace(/[^\w_]/g, "")
        );

        if (existing) {
            await interaction.reply({
                content: `The keyword **"${word}"** already exists in the database.`,
                flags: 1 << 6,
            });
            return;
        }

        try {
            await repo.addKeyword(word);
            await interaction.reply({
                content: `Keyword **"${word}"** has been added successfully!`,
                flags: 1 << 6
            });
        } catch (err) {
            console.error("[AddKeyword] Failed to add keyword:", err);
            await interaction.reply({
                content: "Failed to add keyword. Check logs for details.",
                flags: 1 << 6
            });
        }
    },
};

export default addkeyword;