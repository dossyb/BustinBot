import { SlashCommandBuilder, ChatInputCommandInteraction, Message, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import type { ServiceContainer } from "../../../core/services/ServiceContainer.js";
import { isMentionSuppressed, withSuppressedMentions } from "../../../utils/MentionUtils.js";

const sendas: Command = {
    name: "sendas",
    description: "Send a message as BustinBot in a chosen channel",
    module: CommandModule.Core,
    allowedRoles: [CommandRole.BotAdmin],
    usage: "/sendas <channel> <message>",
    examples: [
        "/sendas #general Hello, this is BustinBot!"
    ],

    slashData: new SlashCommandBuilder()
        .setName("sendas")
        .setDescription("Send a message as BustinBot in a chosen channel")
        .addChannelOption(option =>
            option.setName("channel")
                .setDescription("Select the channel to send the message in")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("message")
                .setDescription("The message to send as BustinBot")
                .setRequired(true)
        ),

    async execute({ interaction, message, services }: { interaction?: ChatInputCommandInteraction, message?: Message, services: ServiceContainer }) {
        if (message) {
            await message.reply("The `!sendas` command has been replaced with a slash command. Please use `/sendas` instead.");
            return;
        }

        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channel = interaction.options.getChannel("channel", true);
        const messageText = interaction.options.getString("message", true);

        if (!("send" in channel)) {
            await interaction.editReply({ content: "Please select a valid text channel." });
            return;
        }

        const suppressMentions = await isMentionSuppressed(services.guilds, interaction.guildId);
        try {
            await channel.send(withSuppressedMentions({ content: messageText }, suppressMentions));
        } catch (error) {
            console.error("Error sending message:", error);
            await interaction.editReply({ content: "Failed to send message." });
            return;
        }

        await interaction.editReply({ content: `Message sent in ${channel}.` });
    }
}

export default sendas;
