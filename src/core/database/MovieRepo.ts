import { db } from "./firestore";
import { GuildScopedRepository } from "./CoreRepo";
import type { IMovieRepository } from "./interfaces/IMovieRepo";
import type { Movie } from "../../models/Movie";
import type { MoviePoll } from "../../models/MoviePoll";
import type { MovieEvent } from "../../models/MovieEvent";

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
        const snapshot = await this.pollsCollection
            .where('isActive', '==', true)
            .limit(1)
            .get();

        if (snapshot.empty) return null;
        return snapshot.docs[0]?.data() as MoviePoll;
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
        await this.eventsCollection.doc(event.id).set(event);
    }

    async getLatestEvent(): Promise<MovieEvent | null> {
        const snapshot = await this.eventsCollection
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

        if (snapshot.empty) return null;
        return snapshot.docs[0]?.data() as MovieEvent;
    }

    async getAllEvents(): Promise<MovieEvent[]> {
        const snapshot = await this.eventsCollection.orderBy('createdAt', 'desc').get();
        return snapshot.docs.map((doc) => doc.data() as MovieEvent);
    }

    async clearEvents(): Promise<void> {
        const snapshot = await this.eventsCollection.get();
        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
    }
}