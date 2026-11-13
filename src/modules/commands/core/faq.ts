import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";

const FAQ_LINK = "https://github.com/dossyb/BustinBot/wiki";

const faq: Command = {
    name: "faq",
    description: "Get the link to the BustinBot FAQ.",
    module: CommandModule.Core,
    allowedRoles: [CommandRole.Everyone],

    slashData: new SlashCommandBuilder()
        .setName("faq")
        .setDescription("Get the link to the BustinBot FAQ."),

    async execute({ interaction }: { interaction?: ChatInputCommandInteraction }) {
        if (!interaction) return;

        await interaction.reply({
            content: `Need help? Click here to view the BustinBot FAQ: ${FAQ_LINK}`,
            flags: MessageFlags.Ephemeral,
        });
    },
};

export default faq;
