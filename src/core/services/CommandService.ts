import path from 'path';
import { readdirSync, statSync } from 'fs';
import { pathToFileURL } from 'url';
import type { Command } from '../../models/Command.js';

const commandMap = new Map<string, Command>();

async function loadCommandFiles(dir: string): Promise<void> {
    const entries = readdirSync(dir);

    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
            // skip test directories and internal folders
            if (entry === "__tests__" || entry.startsWith("__")) continue;
            await loadCommandFiles(fullPath);
            continue;
        }

        const ext = path.extname(entry);
        const isJsCommand =
            ext === ".js" &&
            !entry.endsWith(".d.ts") &&
            !entry.endsWith(".test.js") &&
            !entry.endsWith(".js.map");
        const isTsCommand =
            ext === ".ts" &&
            !entry.endsWith(".d.ts") &&
            !entry.endsWith(".test.ts");

        if (!isJsCommand && !isTsCommand) continue;

        try {
            const commandUrl = pathToFileURL(fullPath).href;
            const commandModule = await import(commandUrl);
            const command: Command = commandModule.default;

            if (!command || !command.name) {
                console.warn(`⚠️  Skipped invalid command module: ${fullPath}`);
                continue;
            }

            commandMap.set(command.name, command);

            // register aliases if any
            if (command.aliases) {
                for (const alias of command.aliases) {
                    commandMap.set(alias, command);
                }
            }
        } catch (err) {
            console.error(`❌ Failed to load command ${entry}:`, err);
        }
    }
}

export async function loadCommands(commandsDir: string): Promise<Map<string, Command>> {
    commandMap.clear();
    await loadCommandFiles(commandsDir);
    return commandMap;
}
