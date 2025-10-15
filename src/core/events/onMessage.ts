import { Message, GuildMember } from 'discord.js';
import type { Command } from '../../models/Command';
import { CommandRole } from '../../models/Command';
import { loadCommands } from '../services/CommandService';

const PREFIX = '!'; // Handle ! as the command prefix
const commands = loadCommands('./src/modules/commands');

export async function handleMessage(message: Message, commands: Map<string, Command>, services: { botStats: any }) {
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

    const roleNames = member.roles.cache.map(role => role.name);

    // Role-based permission logic
    const hasPermission =
        command.allowedRoles.includes(CommandRole.Everyone) ||
        command.allowedRoles.some(role => {
            switch (role) {
                case CommandRole.BotAdmin:
                    return roleNames.includes(process.env.ADMIN_ROLE_NAME || 'BustinBot Admin');
                case CommandRole.MovieAdmin:
                    return roleNames.includes(process.env.MOVIE_ADMIN_ROLE_NAME || 'Movie Admin');
                case CommandRole.TaskAdmin:
                    return roleNames.includes(process.env.TASK_ADMIN_ROLE_NAME || 'Task Admin');
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
