import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { scheduleMovieReminders } from '../MovieReminders.js';

const baseServices = {
  guildId: 'guild-1',
  guilds: {
    get: vi.fn(),
  },
  repos: {
    movieRepo: {
      getActivePoll: vi.fn().mockResolvedValue({ isActive: false }),
      getActiveEvent: vi.fn().mockResolvedValue({ movie: { title: 'Inception' } }),
    },
  },
} as any;

const movieStart = DateTime.utc().plus({ hours: 1 });

describe('MovieReminders channel handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(global, 'setTimeout').mockImplementation(((handler: TimerHandler): any => {
      if (typeof handler === 'function') handler();
      return 0 as any;
    }) as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    baseServices.guilds.get.mockReset();
    baseServices.repos.movieRepo.getActiveEvent.mockClear();
    baseServices.repos.movieRepo.getActivePoll.mockClear();
  });

  it('logs warning when guild configuration is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const services = {
      ...baseServices,
      guildId: undefined,
    } as any;

    await scheduleMovieReminders(services, movieStart, {} as any);

    expect(warnSpy).toHaveBeenCalledWith('[MovieReminders] Missing guild configuration for reminders.');
    warnSpy.mockRestore();
  });

  it('logs warning when movie-night channel cannot be resolved', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const guildMock = {
      channels: {
        fetch: vi.fn().mockResolvedValue(null),
        cache: { find: vi.fn().mockReturnValue(undefined) },
      },
      roles: { cache: { get: vi.fn() } },
    };

    const client: any = {
      guilds: { fetch: vi.fn().mockResolvedValue(guildMock) },
    };

    const services = {
      ...baseServices,
      guilds: {
        get: vi.fn().mockResolvedValue({ channels: {}, roles: {} }),
      },
    } as any;

    await scheduleMovieReminders(services, movieStart, client);

    expect(warnSpy).toHaveBeenCalledWith('[MovieReminders] Could not find movie-night channel.');
    warnSpy.mockRestore();
  });
});
