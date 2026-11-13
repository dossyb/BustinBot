import type { Guild as DiscordGuild } from "discord.js";

export function truncate(text: string, length: number): string {
    return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

export function channelLabel(guild: DiscordGuild, channelId: string | undefined): string {
    return channelId ? `#${guild.channels.cache.get(channelId)?.name ?? channelId}` : "None";
}

export function roleLabel(guild: DiscordGuild, roleId: string | undefined): string {
    return roleId ? `@${guild.roles.cache.get(roleId)?.name ?? roleId}` : "None";
}
