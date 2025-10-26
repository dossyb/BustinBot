import { db } from "./firestore";
import { GuildScopedRepository } from "./CoreRepo";
import type { IMovieRepository } from "./interfaces/IMovieRepo";
import type { Movie } from "../../models/Movie";
import type { MoviePoll } from "../../models/MoviePoll";
import type { MovieEvent } from "../../models/MovieEvent";
import { normaliseFirestoreDates } from "../../utils/DateUtils";

export class MovieRepository extends GuildScopedRepository<Movie> implements IMovieRepository {
    constructor(guildId: string) {
        super(guildId, 'movies');
    }

    async getAllMovies(): Promise<Movie[]> {
        const snapshot = await this.collection.get();
        return snapshot.docs.map((doc) => doc.data() as Movie);
    }

    async getMovieById(id: string): Promise<Movie | null> {
        const doc = await this.collection.doc(id).get();
        return doc.exists ? (doc.data() as Movie): null;
    }

    async upsertMovie(movie: Movie): Promise<void> {
        await this.collection.doc(movie.id).set(movie);
    }

    async deleteMovie(id: string): Promise<void> {
        await this.collection.doc(id).delete();
    }

    private get pollsCollection() {
        return db.collection(`guilds/${this.guildId}/moviePolls`);
    }

    async createPoll(poll: MoviePoll): Promise<void> {
        await this.pollsCollection.doc(poll.id).set(poll);
    }

    async getActivePoll(): Promise<MoviePoll | null> {
        const snapshot = await this.pollsCollection.where('isActive', '==', true).get();

        if (snapshot.empty) return null;

        const polls = snapshot.docs
            .map((doc) => {
                const raw = doc.data() as MoviePoll & Record<string, unknown>;
                const data = normaliseFirestoreDates(raw);
                const createdAt = data.createdAt instanceof Date ? data.createdAt : new Date(0);
                const endsAt = data.endsAt instanceof Date ? data.endsAt : null;
                return {
                    ...data,
                    id: doc.id,
                    createdAt,
                    endsAt: endsAt ?? createdAt,
                };
            })
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        const activePoll = polls[0];
        if (!activePoll) return null;

        if (!activePoll.endsAt) {
            console.warn('[MovieRepository] Active poll is missing endsAt. Using createdAt as fallback.');
            activePoll.endsAt = activePoll.createdAt;
        }

        return activePoll;
    }

    async closePoll(pollId: string): Promise<void> {
        const docRef = this.pollsCollection.doc(pollId);
        await docRef.update({ isActive: false, closedAt: new Date() });
    }

    async clearPolls(): Promise<void> {
        const snapshot = await this.pollsCollection.get();
        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    private get eventsCollection() {
        return db.collection(`guilds/${this.guildId}/movieEvents`);
    }

    async createMovieEvent(event: MovieEvent): Promise<void> {
        const payload: MovieEvent = {
            ...event,
            createdAt: event.createdAt ?? new Date(),
        };
        await this.eventsCollection.doc(payload.id).set(payload);
    }

    async getActiveEvent(): Promise<MovieEvent | null> {
        const snapshot = await this.eventsCollection
            .where('completed', '==', false)
            .get();

        if (snapshot.empty) return null;

        const events = snapshot.docs
            .map(doc => normaliseFirestoreDates(doc.data() as MovieEvent))
            .sort((a, b) => {
                const aTime = a.startTime instanceof Date ? a.startTime.getTime() : 0;
                const bTime = b.startTime instanceof Date ? b.startTime.getTime() : 0;
                return bTime - aTime;
            });

        return events[0] ?? null;
    }

    async getLatestEvent(): Promise<MovieEvent | null> {
        const snapshot = await this.eventsCollection
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

        if (snapshot.empty) return null;
        return normaliseFirestoreDates(snapshot.docs[0]!.data() as MovieEvent);
    }

    async getAllEvents(): Promise<MovieEvent[]> {
        const snapshot = await this.eventsCollection.orderBy('createdAt', 'desc').get();
        return snapshot.docs.map((doc) => normaliseFirestoreDates(doc.data() as MovieEvent));
    }

    async clearEvents(): Promise<void> {
        const snapshot = await this.eventsCollection.get();
        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }

    async voteInPollOnce(pollId: string, userId: string, optionId: string): Promise<{ firstTime: boolean, updatedPoll: MoviePoll; }> {
        const pollRef = this.pollsCollection.doc(pollId);
        return db.runTransaction(async (tx) => {
            const snap = await tx.get(pollRef);
            if (!snap.exists) throw new Error("Poll not found.");
            const poll = snap.data() as MoviePoll;

            poll.votes = poll.votes ?? {};
            const firstTime = !poll.votes[userId];

            poll.votes[userId] = optionId;
            tx.set(pollRef, poll, { merge: true });

            return { firstTime, updatedPoll: poll };
        });
    }
}
