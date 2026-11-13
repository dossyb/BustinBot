import { SlashCommandBuilder, ActionRowBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } from "discord.js";
import type { Command } from "../../../models/Command.js";
import { CommandModule, CommandRole } from "../../../models/Command.js";
import { channelLabel, roleLabel } from "../../../utils/TextUtils.js";

const tasksetup: Command = {
    name: "tasksetup",
    description: "Configure channels and roles for the task module.",
    module: CommandModule.Core,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName("tasksetup")
        .setDescription("Configure channels and roles for the task module."),

    async execute({ interaction, services }) {
        if (!interaction) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildId = interaction.guildId;
        const guild = await interaction.client.guilds.fetch(guildId);
        const guildConfig = await services.guilds.get(guildId);
        const currentRoles = guildConfig?.roles ?? {};
        const currentChannels = guildConfig?.channels ?? {};

        const adminRoleSelect = new RoleSelectMenuBuilder()
            .setCustomId("tasksetup_admin_role")
            .setPlaceholder(`Role for approving submissions (Current: ${roleLabel(guild, currentRoles.taskAdmin)})`)
            .setMinValues(1)
            .setMaxValues(1);

        const userRoleSelect = new RoleSelectMenuBuilder()
            .setCustomId("tasksetup_user_role")
            .setPlaceholder(`Role notified about tasks (Current: ${roleLabel(guild, currentRoles.taskUser)})`)
            .setMinValues(1)
            .setMaxValues(1);

        const taskChannelSelect = new ChannelSelectMenuBuilder()
            .setCustomId("tasksetup_channel")
            .setPlaceholder(`Channel for task posts (Current: ${channelLabel(guild, currentChannels.taskChannel)})`)
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const verificationChannelSelect = new ChannelSelectMenuBuilder()
            .setCustomId("tasksetup_verification_channel")
            .setPlaceholder(`Channel for managing submissions (Current: ${channelLabel(guild, currentChannels.taskVerification)})`)
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const confirmButton = new ButtonBuilder()
            .setCustomId("tasksetup_confirm")
            .setLabel("Confirm")
            .setStyle(ButtonStyle.Success);

        const cancelButton = new ButtonBuilder()
            .setCustomId("tasksetup_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Danger);

        await interaction.editReply({
            content: "Configure the task roles and channels below, then click **Confirm** to save.",
            components: [
                new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(adminRoleSelect),
                new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(userRoleSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(taskChannelSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(verificationChannelSelect),
                new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton),
            ]
        });
    }
};

export default tasksetup;
