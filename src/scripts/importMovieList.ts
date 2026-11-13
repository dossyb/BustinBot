import fs from "fs";
import path from "path";
import { createFirestore } from "../core/database/firestore.js";
import { fetchMovieDetails } from "../modules/movies/MovieService.js";
import "dotenv/config";

const db = createFirestore();

interface LegacyMovie {
    name: string;
    suggestedby: string;
    userId: string;
}

const guildId = process.env.DISCORD_GUILD_ID;
const inputPath = path.resolve(process.cwd(), "data/legacy-movies.json");

if (!guildId) {
    console.error("DISCORD_GUILD_ID missing from .env");
    process.exit(1);
}

if (!fs.existsSync(inputPath)) {
    console.error("Legacy movie list not found at", inputPath);
    process.exit(1);
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeMovieId(title: string, userId: string): string {
    return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${userId}`;
}

async function importMovieList() {
    const rawData = fs.readFileSync(inputPath, "utf-8");
    const movies: LegacyMovie[] = JSON.parse(rawData);

    console.log(`Found ${movies.length} movies in legacy list.`);
    const collectionRef = db.collection(`guilds/${guildId}/movies`);

    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const entry of movies) {
        const { name, suggestedby, userId } = entry;

        if (!name || !userId) {
            console.warn(`Skipping malformed entry: ${JSON.stringify(entry)}`);
            continue;
        }

        // Check for duplicates
        const docId = makeMovieId(name, userId);
        const docRef = collectionRef.doc(docId);
        const existing = await docRef.get();
        if (existing.exists) {
            skipped++;
            continue;
        }

        try {
            console.log(`🎬 Processing: ${name}`);

            const enriched = await fetchMovieDetails(name);

            if (!enriched?.tmdbId) {
                console.warn(`No TMDb match found for "${name}"`);
                failed++;
                continue;
            }

            const movieData = {
                id: docId,
                title: enriched.title ?? name,
                tmdbId: enriched.tmdbId,
                releaseDate: enriched.releaseDate,
                posterUrl: enriched.posterUrl,
                infoUrl: enriched.infoUrl,
                overview: enriched.overview,
                runtime: enriched.runtime,
                rating: enriched.rating,
                genres: enriched.genres,
                director: enriched.director,
                cast: enriched.cast,
                watched: false,
                addedBy: userId,
                addedByDisplay: suggestedby,
                addedAt: new Date(),
            };

            await docRef.set(movieData);
            imported++;
            console.log(`✅ Imported: ${movieData.title} (${movieData.releaseDate ?? "N/A"})`);
        } catch (err) {
            console.error(`Failed to import "${name}":`, (err as Error).message);
            failed++;
        }

        // Prevent TMDb rate-limiting
        await sleep(500);
    }

    console.log("\n📊 Import complete:");
    console.log(`   ✅ Imported: ${imported}`);
    console.log(`   ⚠️ Skipped (already exist): ${skipped}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📁 Guild: ${guildId}`);
}

// Run script
importMovieList().catch((err) => {
    console.error("Fatal error during import:", err);
    process.exit(1);
});
