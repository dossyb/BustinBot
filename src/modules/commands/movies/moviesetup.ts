import { SlashCommandBuilder, ActionRowBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { channelLabel, roleLabel } from "../../../utils/TextUtils.js";

const moviesetup: Command = {
    name: "moviesetup",
    description: "Configure channels and roles for the movie module.",
    module: CommandModule.Core,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("moviesetup")
        .setDescription("Configure channels and roles for the movie module."),

    async execute({ interaction, services }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guildId;
        const guild = await interaction.client.guilds.fetch(guildId);
        const guildConfig = await services.guilds.get(guildId);
        const currentRoles = guildConfig?.roles ?? {};
        const currentChannels = guildConfig?.channels ?? {};

        const adminRoleSelect = new RoleSelectMenuBuilder()
            .setCustomId("moviesetup_admin_role")
            .setPlaceholder(`Role for movie admin commands (Current: ${roleLabel(guild, currentRoles.movieAdmin)})`)
            .setMinValues(1)
            .setMaxValues(1);

        const notifyRoleSelect = new RoleSelectMenuBuilder()
            .setCustomId("moviesetup_user_role")
            .setPlaceholder(`Role notified for movie nights (Current: ${roleLabel(guild, currentRoles.movieUser)})`)
            .setMinValues(1)
            .setMaxValues(1);

        const movieNightChannelSelect = new ChannelSelectMenuBuilder()
            .setCustomId("moviesetup_channel")
            .setPlaceholder(`Channel for movie night announcements (Current: ${channelLabel(guild, currentChannels.movieNight)})`)
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const movieVCSelect = new ChannelSelectMenuBuilder()
            .setCustomId("moviesetup_voice_channel")
            .setPlaceholder(`Voice channel for movie nights (Current: ${channelLabel(guild, currentChannels.movieVC)})`)
            .setChannelTypes(ChannelType.GuildVoice)
            .setMinValues(1)
            .setMaxValues(1);

        const confirmButton = new ButtonBuilder()
            .setCustomId("moviesetup_confirm")
            .setLabel("Confirm")
            .setStyle(ButtonStyle.Success);

        const cancelButton = new ButtonBuilder()
            .setCustomId("moviesetup_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Danger);

        await interaction.editReply({
            content: "Select the channels and roles below, then click **Confirm** to save.",
            components: [
                new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(adminRoleSelect),
                new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(notifyRoleSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(movieNightChannelSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(movieVCSelect),
                new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton),
            ]
        });
    }
};

export default moviesetup;