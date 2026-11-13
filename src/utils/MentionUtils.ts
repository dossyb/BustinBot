import type { MessageMentionOptions } from "discord.js";
import type { GuildService } from "../core/services/GuildService.js";

type GuildLookup = Pick<GuildService, "get"> | { get?: (guildId: string) => Promise<{ mentionSuppressedUntilMs?: number } | null> };

export function isSuppressionWindowActive(untilMs: number | undefined, nowMs: number = Date.now()): boolean {
    return typeof untilMs === "number" && untilMs > nowMs;
}

function stripMentionTokens(content: string): string {
    return content
        .replace(/<@&\d+>/g, "")
        .replace(/<@!?\d+>/g, "")
        .replace(/@everyone/g, "")
        .replace(/@here/g, "")
        .replace(/\s{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export async function isMentionSuppressed(guilds: GuildLookup | null | undefined, guildId?: string | null): Promise<boolean> {
    if (!guildId) return false;
    if (!guilds || typeof guilds.get !== "function") return false;

    const guildConfig = await guilds.get(guildId);
    return isSuppressionWindowActive(guildConfig?.mentionSuppressedUntilMs);
}

export function withSuppressedMentions<T extends object>(
    payload: T,
    suppressMentions: boolean
): T & { allowedMentions?: MessageMentionOptions } {
    if (!suppressMentions) return payload;

    return {
        ...payload,
        ...("content" in payload && typeof payload.content === "string"
            ? { content: stripMentionTokens(payload.content) }
            : {}),
        allowedMentions: {
            parse: [],
            users: [],
            roles: [],
            repliedUser: false,
        },
    };
}
