import { SlashCommandBuilder, ActionRowBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import type { Command } from "models/Command";
import { CommandModule, CommandRole } from "models/Command";

const setup: Command = {
    name: 'setup',
    description: 'Configure the general bot channels (announcements, logs, archive).',
    module: CommandModule.Core,
    allowedRoles: [CommandRole.BotAdmin],

    slashData: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure the general bot channels (announcements, logs, archive).'),

    async execute({ interaction, services }) {
        if (!interaction || !services) return;

        const guild = interaction.guild!;
        const guildId = interaction.guildId!;
        const guildConfig = await services.guilds.ensureExists(guildId, interaction.user.id);
        const current = guildConfig?.channels ?? {};

        const announceChannelName = current.announcements
            ? guild.channels.cache.get(current.announcements)?.name ?? `#${current.announcements}`
            : 'None';

        const logChannelName = current.botLog
            ? guild.channels.cache.get(current.botLog)?.name ?? `#${current.botLog}`
            : 'None';

        const archiveChannelName = current.botArchive
            ? guild.channels.cache.get(current.botArchive)?.name ?? `#${current.botArchive}`
            : 'None';

        const announceSelect = new ChannelSelectMenuBuilder()
            .setCustomId('setup_announce')
            .setPlaceholder(
                `Channel for bot announcements (Current: #${announceChannelName})`)
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const logSelect = new ChannelSelectMenuBuilder()
            .setCustomId('setup_log')
            .setPlaceholder(
                `Channel for errors and logs (Current: #${logChannelName})`
            )
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const archiveSelect = new ChannelSelectMenuBuilder()
            .setCustomId('setup_archive')
            .setPlaceholder(
                `Channel for archived posts (Current: #${archiveChannelName})`
            )
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(1)
            .setMaxValues(1);

        const timezoneButton = new ButtonBuilder()
            .setCustomId('setup_timezone')
            .setLabel('Set Timezone')
            .setStyle(ButtonStyle.Primary);

        const confirmButton = new ButtonBuilder()
            .setCustomId('setup_confirm')
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Success);

        const cancelButton = new ButtonBuilder()
            .setCustomId('setup_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger);

        await interaction.reply({
            content: 'Select a channel for each category below, then click **Confirm** to save.',
            components: [
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(announceSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(logSelect),
                new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(archiveSelect),
                new ActionRowBuilder<ButtonBuilder>().addComponents(timezoneButton, confirmButton, cancelButton),
            ],
            flags: 1 << 6
        });
    }
};

export default setup;