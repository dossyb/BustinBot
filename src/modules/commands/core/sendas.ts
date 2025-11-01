import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel, Message } from 'discord.js';
import type { Command } from '../../../models/Command.js';
import { CommandModule, CommandRole } from '../../../models/Command.js';
import type { ServiceContainer } from '../../../core/services/ServiceContainer.js';

const sendas: Command = {
    name: 'sendas',
    description: 'Send a message as BustinBot in a chosen channel',
    module: CommandModule.Core,
    allowedRoles: [CommandRole.BotAdmin],
    usage: '/sendas <channel> <message>',
    examples: [
        '/sendas #general Hello, this is BustinBot!'
    ],

    slashData: new SlashCommandBuilder()
        .setName('sendas')
        .setDescription('Send a message as BustinBot in a chosen channel')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Select the channel to send the message in')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The message to send as BustinBot')
                .setRequired(true)
        ) as SlashCommandBuilder,

    async execute({ interaction, message, services }: { interaction?: ChatInputCommandInteraction, message?: Message, services?: ServiceContainer }) {
        if (message) {
            await message.reply('The `!sendas` command has been replaced with a slash command. Please use `/sendas` instead.');
            return;
        }

        if (!interaction || !interaction.guild || !interaction.member || !services) {
            await interaction?.reply?.({ content: 'Unable to verify your permissions.', flags: 1 << 6 });
            return;
        }

        const guildConfig = await services.guilds.requireConfig(interaction);
        if (!guildConfig) return;

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const adminRoleConfig = guildConfig.roles?.admin ?? process.env.ADMIN_ROLE_NAME;
        const hasAdminRole =
            !!adminRoleConfig &&
            member.roles.cache.some((role) =>
                /^\d+$/.test(adminRoleConfig)
                    ? role.id === adminRoleConfig
                    : role.name === adminRoleConfig
            );
        
        if (!hasAdminRole) {
            await interaction.reply({ content: 'You need the BustinBot Admin role to use this command.', flags: 1 << 6 });
            return;
        }

        const channel = interaction.options.getChannel('channel');
        const messageText = interaction.options.getString('message');

        if (!channel || !('send' in channel)) {
            await interaction.reply({ content: 'Please select a valid text channel.', flags: 1 << 6 });
            return;
        }

        try {
            await (channel as TextChannel).send(messageText || '');
            await interaction.reply({ content: `Message sent in ${channel}.`, flags: 1 << 6 });
        } catch (error) {
            console.error('Error sending message:', error);
            await interaction.reply({ content: 'Failed to send message.', flags: 1 << 6 });
        }
    }
}

export default sendas;
