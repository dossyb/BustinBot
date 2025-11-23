import { Client, VoiceState } from 'discord.js';
import type { VoiceBasedChannel } from 'discord.js';
import type { ServiceContainer } from '../../core/services/ServiceContainer.js';
import { DateTime } from 'luxon';

const MIN_ATTENDANCE_MS = 30 * 60 * 1000; // 30 mins
const PRESENCE_POLL_INTERVAL_MS = 60 * 1000; // Poll every minute as a safety net

interface ActiveSession {
    joinTime: number;
    totalTime: number;
    metThreshold: boolean;
}

interface AttendanceInitOptions {
    channelId: string;
    startTime: Date;
    initialUserIds?: string[];
    client?: Client;
}

const activeSessions = new Map<string, ActiveSession>();
let activeChannelId: string | null = null;
let movieStartTime: Date | null = null;
let presencePollTimer: NodeJS.Timeout | null = null;

export function initAttendanceTracking(options: AttendanceInitOptions) {
    const { channelId, startTime, initialUserIds = [], client } = options;

    activeChannelId = channelId;
    movieStartTime = startTime;
    activeSessions.clear();

    if (presencePollTimer) {
        clearInterval(presencePollTimer);
        presencePollTimer = null;
    }

    const now = Date.now();
    for (const userId of initialUserIds) {
        activeSessions.set(userId, { joinTime: now, totalTime: 0, metThreshold: false });
        console.log(`[MovieAttendance] Seeded tracking for ${userId} already in channel ${channelId}`);
    }
    console.log(`[MovieAttendance] Tracking started for channel ${channelId}`);

    if (client) {
        presencePollTimer = setInterval(() => pollChannelPresence(client), PRESENCE_POLL_INTERVAL_MS);
    }
}

export function registerVoiceListeners(client: Client) {
    client.on("voiceStateUpdate", (oldState: VoiceState, newState: VoiceState) => {
        if (!activeChannelId) return;

        const userId = newState.id;
        const now = Date.now();

        // User joins VC
        if (newState.channelId === activeChannelId && oldState.channelId !== activeChannelId) {
            const existing = activeSessions.get(userId);
            const totalTime = existing?.totalTime ?? 0;
            activeSessions.set(userId, { joinTime: now, totalTime, metThreshold: existing?.metThreshold ?? false });
            console.log(`[MovieAttendance] ${userId} joined tracked channel ${activeChannelId}`);
        }

        // User leaves VC
        if (oldState.channelId === activeChannelId && newState.channelId !== activeChannelId) {
            captureLeave(userId, now);
        }
    })
}

export async function finaliseAttendance(services: ServiceContainer) {
    if (!activeChannelId || !movieStartTime) return [];

    if (presencePollTimer) {
        clearInterval(presencePollTimer);
        presencePollTimer = null;
    }

    const now = Date.now();
    const attendees: string[] = [];

    for (const [userId, session] of activeSessions.entries()) {
        const totalTime = session.totalTime + (session.joinTime ? now - session.joinTime : 0);
        const totalMinutes = Math.round(totalTime / 60000);
        if (totalTime >= MIN_ATTENDANCE_MS) {
            if (!session.metThreshold) {
                console.log(`[MovieAttendance] ${userId} reached threshold during finalisation (${totalMinutes} mins).`);
            }
            attendees.push(userId);
            console.log(`[MovieAttendance] ${userId} counted as attendee with ${totalMinutes} mins watched.`);
        } else {
            console.log(`[MovieAttendance] ${userId} watched ${totalMinutes} mins (< ${MIN_ATTENDANCE_MS / 60000}); not counted.`);
        }
    }

    console.log(`[MovieAttendance] There were ${attendees.length} attendees for movie night.`);

    const userRepo = services.repos.userRepo;
    if (!userRepo) {
        console.error('[MovieAttendance] User repository not available in ServiceContainer.');
        cleanupTrackingState();
        return attendees;
    }

    for (const userId of attendees) {
        try {
            await userRepo.incrementStat(userId, "moviesAttended", 1);
        } catch (err) {
            console.warn(`[MovieAttendance] Failed to increment moviesAttended for ${userId}:`, err);
        }
    }

    cleanupTrackingState();
    return attendees;
}

function cleanupTrackingState() {
    if (presencePollTimer) {
        clearInterval(presencePollTimer);
        presencePollTimer = null;
    }
    activeChannelId = null;
    activeSessions.clear();
    movieStartTime = null;
}

function isVoiceChannel(channel: unknown): channel is VoiceBasedChannel {
    return !!channel && typeof (channel as VoiceBasedChannel).isVoiceBased === 'function' && (channel as VoiceBasedChannel).isVoiceBased();
}

export async function getActiveVoiceMemberIds(client: Client, channelId: string): Promise<string[]> {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!isVoiceChannel(channel)) return [];
        return Array.from(channel.members.keys());
    } catch (err) {
        console.warn(`[MovieAttendance] Failed to inspect voice channel ${channelId}:`, err);
        return [];
    }
}

async function pollChannelPresence(client: Client) {
    if (!activeChannelId) return;
    const memberIds = await getActiveVoiceMemberIds(client, activeChannelId);
    const now = Date.now();
    const memberSet = new Set(memberIds);

    for (const userId of memberIds) {
        const session = activeSessions.get(userId);
        if (!session) {
            activeSessions.set(userId, { joinTime: now, totalTime: 0, metThreshold: false });
            console.log(`[MovieAttendance] ${userId} detected in channel ${activeChannelId} via poll.`);
        } else if (!session.joinTime) {
            session.joinTime = now;
            console.log(`[MovieAttendance] ${userId} rejoined channel ${activeChannelId} via poll detection.`);
        }
    }

    for (const [userId, session] of activeSessions.entries()) {
        if (session.joinTime && !memberSet.has(userId)) {
            captureLeave(userId, now);
        }
    }
}

function captureLeave(userId: string, timestamp: number) {
    const session = activeSessions.get(userId);
    if (session && session.joinTime) {
        session.totalTime += timestamp - session.joinTime;
        session.joinTime = 0;
        console.log(`[MovieAttendance] ${userId} left channel ${activeChannelId} with total ${Math.round(session.totalTime / 60000)} mins`);
        if (!session.metThreshold && session.totalTime >= MIN_ATTENDANCE_MS) {
            session.metThreshold = true;
            console.log(`[MovieAttendance] ${userId} has met the ${MIN_ATTENDANCE_MS / 60000} minute threshold.`);
        }
    }
}
