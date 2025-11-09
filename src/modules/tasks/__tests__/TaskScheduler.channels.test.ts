import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { getDefaultChannel } from '../TaskScheduler.js';

function createServices(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    guildId: 'guild-1',
    guilds: {
      get: vi.fn().mockResolvedValue({ channels: { taskChannel: 'task-channel-id' } }),
    },
    ...overrides,
  } as any;
}

describe('TaskScheduler getDefaultChannel', () => {
  it('returns null when guild id or channel config is missing', async () => {
    const services = createServices();
    services.guildId = undefined;
    const client: Partial<Client> = {};

    await expect(getDefaultChannel(client as Client, services)).resolves.toBeNull();

    services.guildId = 'guild-1';
    (services.guilds.get as any).mockResolvedValue({ channels: {} });
    await expect(getDefaultChannel(client as Client, services)).resolves.toBeNull();
  });

  it('returns null when fetched channel is not text-based', async () => {
    const services = createServices();
    const channelFetch = vi.fn().mockResolvedValue({ isTextBased: () => false });
    const client: any = {
      guilds: { fetch: vi.fn().mockResolvedValue({ channels: { fetch: channelFetch } }) },
    };

    await expect(getDefaultChannel(client, services)).resolves.toBeNull();
    expect(channelFetch).toHaveBeenCalledWith('task-channel-id');
  });

  it('returns text channel when configuration and permissions are valid', async () => {
    const textChannel = { isTextBased: () => true };
    const channelFetch = vi.fn().mockResolvedValue(textChannel);
    const client: any = {
      guilds: { fetch: vi.fn().mockResolvedValue({ channels: { fetch: channelFetch } }) },
    };
    const services = createServices();

    await expect(getDefaultChannel(client, services)).resolves.toBe(textChannel);
  });
});
