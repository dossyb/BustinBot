import type { Client, VoiceState } from "discord.js";
import { Duration } from "luxon";

export const MIN_ATTENDANCE_MS = Duration.fromObject({ minutes: 30 }).toMillis();

interface Session {
    joinedAt: number | null;
    totalMs: number;
}

export class MovieAttendance {
    private eventId: string | null = null;
    private channelId: string | null = null;
    private readonly sessions = new Map<string, Session>();

    isTracking(eventId: string): boolean {
        return this.eventId === eventId;
    }

    start(eventId: string, channelId: string | null, memberIds: string[], at: Date): void {
        this.stop();
        this.eventId = eventId;
        this.channelId = channelId;
        for (const userId of memberIds) this.sessions.set(userId, { joinedAt: at.getTime(), totalMs: 0 });
        console.log(
            channelId
                ? `[MovieAttendance] Tracking ${memberIds.length} member(s) in ${channelId} for ${eventId}.`
                : `[MovieAttendance] No voice channel for ${eventId}; attendance isn't counted.`
        );
    }

    voiceStateChanged(oldState: VoiceState, newState: VoiceState): void {
        if (!this.channelId) return;
        const at = Date.now();
        // User joins VC
        if (newState.channelId === this.channelId && oldState.channelId !== this.channelId) this.join(newState.id, at);
        // User leaves VC
        if (oldState.channelId === this.channelId && newState.channelId !== this.channelId) this.leave(newState.id, at);
    }

    reconcile(memberIds: string[], at: Date): void {
        if (!this.channelId) return;
        const present = new Set(memberIds);
        for (const userId of present) this.join(userId, at.getTime());
        for (const [userId, session] of this.sessions) {
            if (session.joinedAt !== null && !present.has(userId)) this.leave(userId, at.getTime());
        }
    }

    finish(eventId: string, at: Date): string[] {
        if (this.eventId !== eventId) return [];
        const attendees = [...this.sessions].flatMap(([userId, session]) => {
            const watchedMs = session.totalMs + (session.joinedAt !== null ? at.getTime() - session.joinedAt : 0);
            return watchedMs >= MIN_ATTENDANCE_MS ? [userId] : [];
        });
        this.stop();
        return attendees;
    }

    stop(): void {
        this.eventId = null;
        this.channelId = null;
        this.sessions.clear();
    }

    private join(userId: string, at: number): void {
        const session = this.sessions.get(userId);
        if (!session) {
            this.sessions.set(userId, { joinedAt: at, totalMs: 0 });
        } else if (session.joinedAt === null) {
            session.joinedAt = at;
        }
    }

    private leave(userId: string, at: number): void {
        const session = this.sessions.get(userId);
        if (session?.joinedAt == null) return;
        session.totalMs += at - session.joinedAt;
        session.joinedAt = null;
    }
}

export async function getActiveVoiceMemberIds(client: Client, channelId: string): Promise<string[]> {
    const channel = await client.channels.fetch(channelId).catch((err: unknown) => {
        console.warn(`[MovieAttendance] Failed to inspect voice channel ${channelId}:`, err);
        return null;
    });
    return channel?.isVoiceBased() ? [...channel.members.keys()] : [];
}
