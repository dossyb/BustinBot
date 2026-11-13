import type { Client, GuildTextBasedChannel } from "discord.js";
import type { GuildChannels } from "../models/Guild.js";
import type { ServiceContainer } from "../core/services/ServiceContainer.js";

export async function configuredChannel(
    client: Client,
    services: ServiceContainer,
    purpose: keyof GuildChannels
): Promise<GuildTextBasedChannel | null> {
    const channelId = (await services.guilds.get(services.guildId))?.channels?.[purpose];
    if (!channelId) {
        console.warn(`[Channels] The ${purpose} channel (not set) of guild ${services.guildId} isn't set or can't be reached.`);
        return null;
    }

    let channel;
    try {
        channel = await client.channels.fetch(channelId);
    } catch (err) {
        console.warn(`[Channels] Discord refused the ${purpose} channel ${channelId} of guild ${services.guildId}:`, err);
        return null;
    }
    if (!channel?.isTextBased() || channel.isDMBased()) {
        console.warn(`[Channels] The ${purpose} channel ${channelId} of guild ${services.guildId} isn't set or can't be reached.`);
        return null;
    }
    return channel;
}