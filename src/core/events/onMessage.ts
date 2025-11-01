import { Message, GuildMember } from 'discord.js';
import type { Command } from '../../models/Command.js';
import { CommandRole } from '../../models/Command.js';
import type { ServiceContainer } from '../services/ServiceContainer.js';

const PREFIX = '!'; // Handle ! as the command prefix

export async function handleMessage(message: Message, commands: Map<string, Command>, services: ServiceContainer) {
    if (!message.content.startsWith(PREFIX) || message.author.bot) return;

    const [commandNameRaw, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);

    if (!commandNameRaw) return;

    const commandName = commandNameRaw.toLowerCase();
    const command = commands.get(commandName);

    if (!command) return;

    // Permission check placeholder
    const member = message.member as GuildMember;
    if (!member) {
        await message.reply('Unable to verify your permissions.');
        return;
    }

    const guildConfig = await services.guilds.requireConfig(message);
    if (!guildConfig) return;

    const guildRoles = guildConfig.roles ?? {};
    const userRoleIds = member.roles.cache.map((r) => r.id);

    // Role-based permission logic
    const hasPermission =
        command.allowedRoles.includes(CommandRole.Everyone) ||
        command.allowedRoles.some(role => {
            switch (role) {
                case CommandRole.BotAdmin:
                    return guildRoles.admin && userRoleIds.includes(guildRoles.admin);
                case CommandRole.MovieAdmin:
                    return guildRoles.movieAdmin && userRoleIds.includes(guildRoles.movieAdmin);
                case CommandRole.TaskAdmin:
                    return guildRoles.taskAdmin && userRoleIds.includes(guildRoles.taskAdmin);
                default:
                    return false;
            }
        });

    if (!hasPermission) {
        await message.reply("You don't have permission to use this command.");
        return;
    }

    try {
        await command.execute({ message, args, services });
    } catch (err) {
        console.error(`[Command Error]: ${commandName}`, err);
        message.reply('There was an error executing that command.');
    }
}
