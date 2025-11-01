import { TextChannel } from 'discord.js';
import type { Channel } from 'discord.js';

export function isTextChannel(channel: Channel): channel is TextChannel {
    return channel.isTextBased() && 'name' in channel;
}