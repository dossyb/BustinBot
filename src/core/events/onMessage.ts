import { Message } from 'discord.js';
import type { Command } from '../../models/Command';
import { CommandRole } from '../../models/Command';
import { loadCommands } from '../services/CommandService';

const PREFIX = '!'; // Handle ! as the command prefix
const commands = loadCommands('./src/modules/commands');

function checkPermissions(userId: string, roles: CommandRole[]): boolean {
    // TODO: Replace with real role-check logic using Firestore or role IDs
    return roles.includes(CommandRole.Everyone);
}

export async function handleMessage(message: Message, commands: Map<string, Command>) {
    if (!message.content.startsWith(PREFIX) || message.author.bot) return;

    const [commandNameRaw, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);

    if (!commandNameRaw) return;

    const commandName = commandNameRaw.toLowerCase();
    const command = commands.get(commandName);

    if (!command) return;

    // Permission check placeholder
    const userHasPermission = checkPermissions(message.author.id, command.allowedRoles);
    if (!userHasPermission) {
        message.reply("You don't have permission to use this command.");
        return;
    }

    try {
        await command.execute({ message, args });
    } catch (err) {
        console.error(`[Command Error]: ${commandName}`, err);
        message.reply('There was an error executing that command.');
    }
}
