import { SlashCommandBuilder, ActionRowBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { channelLabel } from "../../../utils/TextUtils.js";

const setup: Command = {
    name: "setup",
    description: "Configure the general bot channels (announcements, logs, archive).",
    module: CommandModule.Core,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Configure the general bot channels (announcements, logs, archive)."),

    async execute({ interaction, services }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guildId;
        const guild = await interaction.client.guilds.fetch(guildId);
        const guildConfig = await services.guilds.ensureExists(guildId, interaction.user.id);
        const current = guildConfig?.channels ?? {};

        const announceSelect = new ChannelSelectMenuBuilder()
            .setCustomId("setup_announce")
            .setPlaceholder(
                `Channel for bot announcements (Current: ${channelLabel(guild, current.announcements)})`)
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const logSelect = new ChannelSelectMenuBuilder()
            .setCustomId("setup_log")
            .setPlaceholder(
                `Channel for errors and logs (Current: ${channelLabel(guild, current.botLog)})`
            )
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const archiveSelect = new ChannelSelectMenuBuilder()
            .setCustomId("setup_archive")
            .setPlaceholder(
                `Channel for archived posts (Current: ${channelLabel(guild, current.botArchive)})`
            )
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const timezoneButton = new ButtonBuilder()
            .setCustomId("setup_timezone")
            .setLabel("Set Timezone")
            .setStyle(ButtonStyle.Primary);

        const confirmButton = new ButtonBuilder()
            .setCustomId("setup_confirm")
            .setLabel("Confirm")
            .setStyle(ButtonStyle.Success);

        const cancelButton = new ButtonBuilder()
            .setCustomId("setup_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Danger);

        await interaction.editReply({
            content: "Select a channel for each category below, then click **Confirm** to save.",
            components: [
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(announceSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(logSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(archiveSelect),
                new ActionRowBuilder<ButtonBuilder>().addComponents(timezoneButton, confirmButton, cancelButton),
            ]
        });
    }
};

export default setup;