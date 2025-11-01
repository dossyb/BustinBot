import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import path from 'path';
import type { Command } from '../models/Command.js';
import { getFilename, getDirname } from './PathUtils.js';
const filename = getFilename(import.meta.url);
const dirname = getDirname(import.meta.url);

config();

export interface RegisterCommandOptions {
    modulesDir?: string;
    token?: string;
    clientId?: string;
    guildId?: string | null;
}

async function loadCommands(dir: string): Promise<Map<string, Command>> {
    const { loadCommands } = await import('../core/services/CommandService.js');
    return loadCommands(dir);
}

function resolveClientId(provided?: string | null) {
    if (provided) return provided;
    if (process.env.BOT_MODE === 'dev' && process.env.DISCORD_CLIENT_ID_DEV) {
        return process.env.DISCORD_CLIENT_ID_DEV;
    }
    return process.env.DISCORD_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID_DEV ?? null;
}

function resolveToken(targetClientId: string | null, provided?: string | null) {
    if (provided) return provided;

    if (targetClientId && process.env.DISCORD_CLIENT_ID_DEV && targetClientId === process.env.DISCORD_CLIENT_ID_DEV) {
        return process.env.DISCORD_TOKEN_DEV ?? process.env.DISCORD_TOKEN_LIVE ?? null;
    }

    return process.env.DISCORD_TOKEN_LIVE ?? process.env.DISCORD_TOKEN_DEV ?? null;
}

function resolveGuildId(provided?: string | null) {
    return provided ?? process.env.DISCORD_GUILD_ID ?? null;
}

async function prepareCommands(modulesDir?: string) {
    const directory = modulesDir ?? path.join(dirname, '..', 'modules', 'commands');
    const commands = await loadCommands(directory);
    const slashCommands = [...commands.values()]
        .filter((cmd) => cmd.slashData)
        .map((cmd) => cmd.slashData!.toJSON());

    if (!slashCommands.length) {
        console.log('No slash commands found to register.');
        return null;
    }

    return slashCommands;
}

export async function registerSlashCommands(options: RegisterCommandOptions = {}) {
    const resolvedClientId = resolveClientId(options.clientId);
    const resolvedToken = resolveToken(resolvedClientId, options.token);
    const resolvedGuildId = resolveGuildId(options.guildId);

    if (!resolvedToken || !resolvedClientId) {
        throw new Error('Discord token and client ID must be set before registering commands.');
    }

    const slashCommands = await prepareCommands(options.modulesDir);
    if (!slashCommands) return;

    const rest = new REST({ version: '10' }).setToken(resolvedToken);

    console.log(`🌍 Registering ${slashCommands.length} commands globally...`);
    await rest.put(Routes.applicationCommands(resolvedClientId), { body: slashCommands });
    console.log('✅ Global registration complete.');

    if (resolvedGuildId) {
        console.log(`🧹 Clearing guild-specific commands for ${resolvedGuildId}...`);
        await rest.put(Routes.applicationGuildCommands(resolvedClientId, resolvedGuildId), { body: [] });
        console.log('✅ Guild command cleanup complete.');
    }
}

export async function registerGuildCommands(options: RegisterCommandOptions = {}) {
    const resolvedClientId = resolveClientId(options.clientId);
    const resolvedToken = resolveToken(resolvedClientId, options.token);
    const resolvedGuildId = resolveGuildId(options.guildId);

    if (!resolvedToken || !resolvedClientId || !resolvedGuildId) {
        throw new Error('Discord token, client ID, and guild ID must be set for guild registration.');
    }

    const slashCommands = await prepareCommands(options.modulesDir);
    if (!slashCommands) return;

    const rest = new REST({ version: '10' }).setToken(resolvedToken);

    console.log(`🏠 Registering ${slashCommands.length} commands for guild ${resolvedGuildId}...`);
    await rest.put(Routes.applicationGuildCommands(resolvedClientId, resolvedGuildId), { body: slashCommands });
    console.log('✅ Guild command sync complete.');
}
