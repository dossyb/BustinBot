import "dotenv/config";
import path from "path";
import { REST } from "discord.js";
import { loadCommands } from "../core/services/CommandService.js";
import { registerGlobalCommands } from "../utils/registerCommands.js";

const clientId =
    (process.env.BOT_MODE === "dev" && process.env.DISCORD_CLIENT_ID_DEV) ||
    process.env.DISCORD_CLIENT_ID ||
    process.env.DISCORD_CLIENT_ID_DEV;
const token =
    clientId && clientId === process.env.DISCORD_CLIENT_ID_DEV
        ? (process.env.DISCORD_TOKEN_DEV ?? process.env.DISCORD_TOKEN_LIVE)
        : (process.env.DISCORD_TOKEN_LIVE ?? process.env.DISCORD_TOKEN_DEV);

try {
    if (!token || !clientId) {
        throw new Error("Discord token and client ID must be set before registering commands.");
    }

    console.log(`[SlashRegister] Mode=${process.env.BOT_MODE ?? "unset"} | Client ID=${clientId}`);
    const commands = await loadCommands(path.join(import.meta.dirname, "..", "modules", "commands"));
    await registerGlobalCommands(new REST().setToken(token), clientId, commands, process.env.DISCORD_GUILD_ID ?? null);
    console.log("✅ Slash command registration complete.");
    process.exit(0);
} catch (err) {
    console.error("Failed to register slash commands:", err);
    process.exit(1);
}
