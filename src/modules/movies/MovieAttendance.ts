import { Client, VoiceState } from 'discord.js';
import type { ServiceContainer } from 'core/services/ServiceContainer';
import { DateTime } from 'luxon';

const MIN_ATTENDANCE_MS = 30 * 60 * 1000; // 30 mins

interface ActiveSession {
    joinTime: number;
    totalTime: number;
}

const activeSessions = new Map<string, ActiveSession>();
let activeChannelId: string | null = null;
let movieStartTime: Date | null = null;

export function initAttendanceTracking(channelId: string, startTime: Date) {
    activeChannelId = channelId;
    movieStartTime = startTime;
    activeSessions.clear();
    console.log(`[MovieAttendance] Tracking started for channel ${channelId}`);
}

export function registerVoiceListeners(client: Client) {
    client.on("voiceStateUpdate", (oldState: VoiceState, newState: VoiceState) => {
        if (!activeChannelId) return;

        const userId = newState.id;
        const now = Date.now();

        // User joins VC
        if (newState.channelId === activeChannelId && oldState.channelId !== activeChannelId) {
            activeSessions.set(userId, { joinTime: now, totalTime: activeSessions.get(userId)?.totalTime ?? 0});
        }

        // User leaves VC
        if (oldState.channelId === activeChannelId && newState.channelId !== activeChannelId) {
            const session = activeSessions.get(userId);
            if (session && session.joinTime) {
                session.totalTime += now - session.joinTime;
                session.joinTime = 0;
            }
        }
    })
}

export async function finaliseAttendance(services: ServiceContainer) {
    if (!activeChannelId || !movieStartTime) return [];

    const now = Date.now();
    const attendees: string[] = [];

    for (const [userId, session] of activeSessions.entries()) {
        const totalTime = session.totalTime + (session.joinTime ? now - session.joinTime : 0);
        if (totalTime >= MIN_ATTENDANCE_MS) {
            attendees.push(userId);
        }
    }

    console.log(`[MovieAttendance] There were ${attendees.length} attendees for movie night.`);

    const userRepo = services.repos.userRepo;
    if (!userRepo) {
        console.error('[MovieAttendance] User repository not available in ServiceContainer.');
        return attendees;
    }

    for (const userId of attendees) {
        try {
            await userRepo.incrementStat(userId, "moviesWatched", 1);
        } catch (err) {
            console.warn(`[MovieAttendance] Failed to increment moviesWatched for ${userId}:`, err);
        }
    }

    // Reset for next event
    activeChannelId = null;
    activeSessions.clear();
    movieStartTime = null;

    return attendees;
}