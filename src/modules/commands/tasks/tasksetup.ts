import { SlashCommandBuilder, ActionRowBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } from "discord.js";
import type { Command } from "models/Command";
import { CommandRole } from "models/Command";

const tasksetup: Command = {
    name: 'tasksetup',
    description: 'Configure channels and roles for the task module.',
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('tasksetup')
        .setDescription('Configure channels and roles for the task module.'),

    async execute({ interaction, services }) {
        if (!interaction || !services) return;

        const guild = interaction.guild!;
        const guildId = interaction.guildId!;
        const guildConfig = await services.guilds.get(guildId);
        const currentRoles = guildConfig?.roles ?? {};
        const currentChannels = guildConfig?.channels ?? {};

        const taskAdminRoleName = currentRoles.taskAdmin
            ? guild.roles.cache.get(currentRoles.taskAdmin)?.name ?? `@${currentRoles.taskAdmin}`
            : 'None';

        const taskUserRoleName = currentRoles.taskUser
            ? guild.roles.cache.get(currentRoles.taskUser)?.name ?? `@${currentRoles.taskUser}`
            : 'None';

        const taskChannelName = currentChannels.taskChannel
            ? guild.channels.cache.get(currentChannels.taskChannel)?.name ?? `#${currentChannels.taskChannel}`
            : 'None';

        const verificationChannelName = currentChannels.taskVerification
            ? guild.channels.cache.get(currentChannels.taskVerification)?.name ?? `#${currentChannels.taskVerification}`
            : 'None';

        const adminRoleSelect = new RoleSelectMenuBuilder()
            .setCustomId('tasksetup_admin_role')
            .setPlaceholder(`Role for approving submissions (Current: ${taskAdminRoleName})`)
            .setMinValues(1)
            .setMaxValues(1);

        const userRoleSelect = new RoleSelectMenuBuilder()
            .setCustomId('tasksetup_user_role')
            .setPlaceholder(`Role notified about tasks (Current: ${taskUserRoleName})`)
            .setMinValues(1)
            .setMaxValues(1);

        const taskChannelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('tasksetup_channel')
            .setPlaceholder(`Channel for task posts (Current: #${taskChannelName})`)
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const verificationChannelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('tasksetup_verification_channel')
            .setPlaceholder(`Channel for managing submissions (Current: #${verificationChannelName})`)
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const confirmButton = new ButtonBuilder()
            .setCustomId('tasksetup_confirm')
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Success);

        const cancelButton = new ButtonBuilder()
            .setCustomId('tasksetup_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger);

        await interaction.reply({
            content: 'Configure the task roles and channels below, then click **Confirm** to save.',
            components: [
                new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(adminRoleSelect),
                new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(userRoleSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(taskChannelSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(verificationChannelSelect),
                new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton),
            ],
            flags: 1 << 6
        });
    }
};

export default tasksetup;