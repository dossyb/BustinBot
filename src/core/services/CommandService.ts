import path from 'path';
import { readdirSync, statSync } from 'fs';
import { pathToFileURL } from 'url';
import type { Command } from '../../models/Command';

const commandMap = new Map<string, Command>();

async function loadCommandFiles(dir: string): Promise<void> {
    const entries = readdirSync(dir);

    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
            await loadCommandFiles(fullPath); // Recursively load commands from subdirectories
        }
        else if (entry.endsWith('.js') || entry.endsWith('.ts')) {
            const commandUrl = pathToFileURL(fullPath).href;
            const commandModule = await import(commandUrl);
            const command: Command = commandModule.default;

            if (!command || !command.name) {
                console.warn(`Skipped invalid command module: ${fullPath}`);
                continue;
            }

            commandMap.set(command.name, command);

            // Register aliases
            if (command.aliases) {
                for (const alias of command.aliases) {
                    commandMap.set(alias, command);
                }
            }
        }
    }
}

export async function loadCommands(commandsDir: string): Promise<Map<string, Command>> {
    await loadCommandFiles(commandsDir);
    return commandMap;
}
