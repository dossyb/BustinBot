import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return Object.assign({}, actual, {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(
      JSON.stringify({ '1.0.0': { title: 'Title', intro: 'Intro', sections: [] } })
    ),
  });
});

vi.mock('../../../utils/version.js', () => ({ packageVersion: '2.0.0' }));

const fs = await import('fs');
const announce = (await import('../core/announce.js')).default;

function createInteraction() {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn(),
    guild: {
      channels: {
        fetch: vi.fn(),
      },
    },
    client: { user: { displayAvatarURL: vi.fn().mockReturnValue('https://avatar') } },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(
    JSON.stringify({ '2.0.0': { title: 'Title', intro: 'Intro', sections: [] } })
  );
});

describe('announce command channel handling', () => {
  it('informs user when announcement channel is not configured', async () => {
    const interaction = createInteraction();
    const services = {
      guilds: {
        requireConfig: vi.fn().mockResolvedValue({ channels: {} }),
      },
    } as any;

    await announce.execute({ interaction, services });

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Announcement channel not configured. Please run `/setup` first.',
    });
  });

  it('informs user when channel fetch fails or is not text-based', async () => {
    const interaction = createInteraction();
    interaction.guild.channels.fetch.mockRejectedValueOnce(new Error('Missing Access'));
    const services = {
      guilds: {
        requireConfig: vi.fn().mockResolvedValue({ channels: { announcements: 'channel-1' } }),
      },
    } as any;

    await announce.execute({ interaction, services });

    expect(interaction.guild.channels.fetch).toHaveBeenCalledWith('channel-1');
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Announcement channel not configured. Please run `/setup` first.',
    });
  });
});
