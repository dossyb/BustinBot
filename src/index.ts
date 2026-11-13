import { Client } from "discord.js";
import { config } from "dotenv";
import path from "path";
import { loadCommands } from "./core/services/CommandService.js";
import { createFirestore } from "./core/database/firestore.js";
import { startBot } from "./bot.js";
import { clientOptions } from "./clientOptions.js";
import { tmdbApiKey } from "./modules/movies/MovieService.js";
const isDryRun = process.argv.includes("--dryrun") || process.argv.includes("--dry-run");

// Load environment variables (only for global secrets)
config();

const commandsDir = path.join(import.meta.dirname, "modules", "commands");
const isDevMode = process.env.BOT_MODE === "dev";
const botToken = isDevMode
    ? process.env.DISCORD_TOKEN_DEV
    : process.env.DISCORD_TOKEN_LIVE ?? process.env.DISCORD_TOKEN_DEV;

function resolveCommandSync(): { token: string; clientId: string } | null {
    const enableSync = process.env.ENABLE_GUILD_COMMAND_SYNC === "true" || isDevMode;
    if (!enableSync) return null;

    const clientId = isDevMode
        ? process.env.DISCORD_CLIENT_ID_DEV
        : process.env.DISCORD_CLIENT_ID ?? process.env.DISCORD_CLIENT_ID_DEV;

    if (!botToken || !clientId) {
        console.warn("[SlashCommands] Skipping guild sync; missing token or client ID env vars.");
        return null;
    }
    return { token: botToken, clientId };
}

async function main(): Promise<void> {
    tmdbApiKey();

    if (isDryRun) {
        console.log("Loading commands...");
        const commands = await loadCommands(commandsDir);
        console.log(`Loaded ${commands.size} commands.`);
        console.log("[DryRun] Startup preflight passed. Skipping Firestore and Discord login.");
        return;
    }

    // Login to Discord with the appropriate bot token
    if (!botToken) {
        throw new Error("No Discord bot token available. Check DISCORD_TOKEN_LIVE / DISCORD_TOKEN_DEV.");
    }

    // Create Discord client with required intents
    const client = new Client(clientOptions);

    const db = createFirestore();
    const shutdown = await startBot(client, {
        db,
        commandsDir,
        fallbackGuildId: process.env.DISCORD_GUILD_ID ?? null,
        commandSync: resolveCommandSync(),
    });

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, () => {
            console.log(`[Shutdown] ${signal} received; stopping BustinBot.`);
            shutdown()
                .then(() => db.terminate())
                .then(
                    () => process.exit(0),
                    (err) => {
                        console.error("[Shutdown] BustinBot did not stop cleanly:", err);
                        process.exit(1);
                    }
                );
        });
    }

    await client.login(botToken);
}

main().catch((err) => {
    console.error("[Startup] BustinBot failed to start:", err);
    process.exitCode = 1;
});
