import { Routes, type REST, type RESTPutAPIApplicationCommandsJSONBody } from "discord.js";
import type { Command } from "../models/Command.js";

function slashCommandPayloads(commands: Map<string, Command>): RESTPutAPIApplicationCommandsJSONBody {
    return [...new Set(commands.values())].flatMap((command) => command.slashData ? [command.slashData.toJSON()] : []);
}

export async function registerGuildCommands(
    rest: REST,
    applicationId: string,
    guildId: string,
    commands: Map<string, Command>
): Promise<void> {
    const body = slashCommandPayloads(commands);
    console.log(`🏠 Registering ${body.length} commands for guild ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body });
    console.log("✅ Guild command sync complete.");
}

export async function registerGlobalCommands(
    rest: REST,
    applicationId: string,
    commands: Map<string, Command>,
    clearGuildId: string | null
): Promise<void> {
    const body = slashCommandPayloads(commands);
    console.log(`🌍 Registering ${body.length} commands globally...`);
    await rest.put(Routes.applicationCommands(applicationId), { body });
    console.log("✅ Global registration complete.");

    if (clearGuildId) {
        console.log(`🧹 Clearing guild-specific commands for ${clearGuildId}...`);
        await rest.put(Routes.applicationGuildCommands(applicationId, clearGuildId), { body: [] });
        console.log("✅ Guild command cleanup complete.");
    }
}
