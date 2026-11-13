import path from "path";
import { readdirSync, statSync } from "fs";
import { pathToFileURL } from "url";
import type { Command } from "../../models/Command.js";

async function loadCommandFiles(dir: string, commandMap: Map<string, Command>): Promise<void> {
    const entries = readdirSync(dir);

    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
            await loadCommandFiles(fullPath, commandMap);
            continue;
        }

        const ext = path.extname(entry);
        if ((ext !== ".js" && ext !== ".ts") || entry.endsWith(".d.ts")) continue;

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
    const commandMap = new Map<string, Command>();
    await loadCommandFiles(commandsDir, commandMap);
    return commandMap;
}
