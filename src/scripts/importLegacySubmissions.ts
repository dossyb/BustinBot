import fs from "fs";
import path from "path";
import { createFirestore } from "../core/database/firestore.js";
import { Timestamp } from "firebase-admin/firestore";
import "dotenv/config";

const db = createFirestore();

interface LegacyStat {
    id: string;
    submissions: number;
}

const guildId = process.env.DISCORD_GUILD_ID!;
const inputPath = path.resolve(process.cwd(), "data/legacy-taskstats.json");

if (!guildId) {
    console.error("DISCORD_GUILD_ID missing from .env");
    process.exit(1);
}

if (!fs.existsSync(inputPath)) {
    console.error("Legacy stats file not found at", inputPath);
    process.exit(1);
}

async function importLegacyStats() {
    const rawData = fs.readFileSync(inputPath, "utf-8");
    const parsed = JSON.parse(rawData);
    const users: LegacyStat[] = Array.isArray(parsed) ? parsed : parsed.users;

    if (!Array.isArray(users)) {
        throw new Error("Invalid JSON structure: expected an array or an object with a 'users' field.");
    }

    console.log(`Found ${users.length} legacy user entries`);
    const userStatsRef = db.collection(`guilds/${guildId}/userStats`);

    let updated = 0;
    let created = 0;
    let failed = 0;

    for (const entry of users) {
        const { id: userId, submissions } = entry;

        if (!userId || typeof submissions !== "number") {
            console.warn(`Skipping invalid entry: ${JSON.stringify(entry)}`);
            continue;
        }

        const docRef = userStatsRef.doc(userId);

        try {
            const docSnap = await docRef.get();

            if (docSnap.exists) {
                await docRef.update({ legacyTasksCompleted: submissions });
                updated++;
                console.log(`Updated ${userId}: ${submissions}`);
            } else {
                await docRef.set({
                    userId,
                    legacyTasksCompleted: submissions,
                    createdAt: Timestamp.now(),
                });
                created++;
                console.log(`Created ${userId}: ${submissions}`);
            }
        } catch (err) {
            console.error(`Failed for ${userId}:`, (err as Error).message);
            failed++;
        }
    }

    console.log("\n📊 Import Summary:");
    console.log(`   🆕 Created: ${created}`);
    console.log(`   🔁 Updated: ${updated}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📁 Guild: ${guildId}`);
}

importLegacyStats().catch((err) => {
    console.error("Fatal error during import:", err);
    process.exit(1);
})
