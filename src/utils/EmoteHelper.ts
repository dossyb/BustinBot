import type { Guild } from "discord.js";

export function getBustinEmote(guild: Guild | null): string | null {
    if (!guild) return null;
    const emote = guild.emojis.cache.find(e => e.name?.toLowerCase() === "bustin");
    return emote ? `<${emote.animated ? "a" : ""}:${emote.name}:${emote.id}>` : null;
}

export function appendBustinEmote(text: string, guild: Guild | null): string {
    const emote = getBustinEmote(guild);
    return emote ? `${text} ${emote}` : text;
}

export function replaceBustinEmote(text: string, guild: Guild | null): string {
    const emote = getBustinEmote(guild);
    return emote ?? text;
}