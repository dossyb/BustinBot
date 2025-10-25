import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType } from "discord.js";
import type { Command } from 'models/Command';
import { CommandRole } from "models/Command";

const moviesetup: Command = {
    name: 'moviesetup',
    description: 'Configure channels and roles for the movie module.',
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('moviesetup')
        .setDescription('Configure channels and roles for the movie module.'),

    async execute({ interaction, services }) {
        if (!interaction || !services) return;

        const guild = interaction.guild!;
        const guildId = interaction.guildId!;
        const guildConfig = await services.guilds.get(guildId);
        const currentRoles = guildConfig?.roles ?? {};
        const currentChannels = guildConfig?.channels ?? {};

        const movieAdminRoleName = currentRoles.movieAdmin
            ? guild.roles.cache.get(currentRoles.movieAdmin)?.name ?? `@${currentRoles.movieAdmin}`
            : 'None';

        const movieNotifyRoleName = currentRoles.movieUser
            ? guild.roles.cache.get(currentRoles.movieUser)?.name ?? `@${currentRoles.movieUser}`
            : 'None';

        const movieChannelName = currentChannels.movieNight
            ? guild.channels.cache.get(currentChannels.movieNight)?.name ?? `#${currentChannels.movieNight}`
            : 'None';

        const movieVoiceName = currentChannels.movieVC
            ? guild.channels.cache.get(currentChannels.movieVC)?.name ?? `#${currentChannels.movieVC}`
            : 'None';

        const adminRoleSelect = new RoleSelectMenuBuilder()
            .setCustomId('moviesetup_admin_role')
            .setPlaceholder(`Role for movie admin commands (Current: ${movieAdminRoleName})`)
            .setMinValues(1)
            .setMaxValues(1);

        const notifyRoleSelect = new RoleSelectMenuBuilder()
            .setCustomId('moviesetup_user_role')
            .setPlaceholder(`Role notified for movie nights (Current: ${movieNotifyRoleName})`)
            .setMinValues(1)
            .setMaxValues(1);

        const movieNightChannelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('moviesetup_channel')
            .setPlaceholder(`Channel for movie night announcements (Current: ${movieChannelName})`)
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const movieVCSelect = new ChannelSelectMenuBuilder()
            .setCustomId('moviesetup_voice_channel')
            .setPlaceholder(`Voice channel for movie nights (Current: #${movieVoiceName})`)
            .setChannelTypes(ChannelType.GuildVoice)
            .setMinValues(1)
            .setMaxValues(1);

        const confirmButton = new ButtonBuilder()
            .setCustomId('moviesetup_confirm')
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Success);

        const cancelButton = new ButtonBuilder()
            .setCustomId('moviesetup_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger);

        await interaction.reply({
            content: 'Select the channels and roles below, then confirm **Confirm** to save.',
            components: [
                new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(adminRoleSelect),
                new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(notifyRoleSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(movieNightChannelSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(movieVCSelect),
                new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton),
            ],
            flags: 1 << 6
        });
    }
};

export default moviesetup;