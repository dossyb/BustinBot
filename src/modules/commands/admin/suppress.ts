import { SlashCommandBuilder, time, TimestampStyles, MessageFlags } from "discord.js";
import { DateTime } from "luxon";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";

const suppress: Command = {
    name: "suppress",
    description: "Temporarily disable role/user pings from bot messages.",
    module: CommandModule.Core,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("suppress")
        .setDescription("Temporarily disable role/user pings from bot messages.")
        .addIntegerOption((option) =>
            option
                .setName("minutes")
                .setDescription("How long mention suppression should stay active.")
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1440)
        ),

    async execute({ interaction, services }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guildId;

        const minutes = interaction.options.getInteger("minutes", true);
        const until = DateTime.now().plus({ minutes }).toJSDate();

        await services.guilds.update(guildId, {
            mentionSuppressedUntilMs: until.getTime(),
            updatedBy: interaction.user.id,
            updatedAt: new Date(),
        });

        await interaction.editReply({
            content: `Mention suppression enabled for **${minutes}** minute${minutes === 1 ? "" : "s"}. It will expire ${time(until, TimestampStyles.RelativeTime)} (${time(until, TimestampStyles.LongDateTime)}).`,
        });
    },
};

export default suppress;
