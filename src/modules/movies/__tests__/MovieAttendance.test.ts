import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { Client, VoiceState } from 'discord.js';
import { initAttendanceTracking, registerVoiceListeners, finaliseAttendance } from '../MovieAttendance';
import type { ServiceContainer } from '../../../core/services/ServiceContainer';

function makeVoiceState(id: string, channelId: string | null): VoiceState {
    return {
        id,
        channelId,
    } as VoiceState;
}

function createServices(incrementStat = vi.fn()) {
    return {
        guildId: 'guild',
        botStats: {} as any,
        tasks: {} as any,
        taskEvents: {} as any,
        keywords: {} as any,
        guilds: {} as any,
        repos: {
            userRepo: {
                incrementStat,
            },
        },
    } as unknown as ServiceContainer;
}

describe('MovieAttendance', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2024-01-01T20:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('tracks and saves attendees who meet the minimum watch time', async () => {
        const client = new EventEmitter() as unknown as Client;
        registerVoiceListeners(client);

        initAttendanceTracking('movie-vc', new Date());

        client.emit('voiceStateUpdate', makeVoiceState('user1', null), makeVoiceState('user1', 'movie-vc'));

        vi.advanceTimersByTime(31 * 60 * 1000);

        client.emit('voiceStateUpdate', makeVoiceState('user1', 'movie-vc'), makeVoiceState('user1', null));

        const incrementStat = vi.fn().mockResolvedValue(undefined);
        const services = createServices(incrementStat);

        const attendees = await finaliseAttendance(services);

        expect(attendees).toEqual(['user1']);
        expect(incrementStat).toHaveBeenCalledWith('user1', 'moviesAttended', 1);
    });

    it('does not count attendees below the threshold', async () => {
        const client = new EventEmitter() as unknown as Client;
        registerVoiceListeners(client);
        initAttendanceTracking('movie-vc', new Date());

        client.emit('voiceStateUpdate', makeVoiceState('user2', null), makeVoiceState('user2', 'movie-vc'));
        vi.advanceTimersByTime(10 * 60 * 1000);
        client.emit('voiceStateUpdate', makeVoiceState('user2', 'movie-vc'), makeVoiceState('user2', null));

        const incrementStat = vi.fn().mockResolvedValue(undefined);
        const services = createServices(incrementStat);

        const attendees = await finaliseAttendance(services);

        expect(attendees).toEqual([]);
        expect(incrementStat).not.toHaveBeenCalled();
    });
});
