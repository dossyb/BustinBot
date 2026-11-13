import fs from "fs";
import path from "path";
import { createFirestore } from "../core/database/firestore.js";
import type { Keyword } from "../models/Keyword.js";
import "dotenv/config";

const db = createFirestore();

const filePath = path.resolve(process.cwd(), "data/keywords.json");

const guildId = process.env.DISCORD_GUILD_ID;
if (!guildId) {
    console.error("DISCORD_GUILD_ID missing from .env");
    process.exit(1);
}

async function importKeywords(guildId: string, filePath: string) {
    const data = fs.readFileSync(filePath, "utf-8");
    const words: unknown = JSON.parse(data);

    if (!Array.isArray(words) || !words.every((word: unknown): word is string => typeof word === "string")) {
        throw new Error("Invalid keywords.json format: expected an array of strings");
    }

    const colRef = db.collection(`guilds/${guildId}/keywords`);
    const batch = db.batch();

    console.log(`Found ${words.length} keywords`);

    for (const word of words) {
        const id = word.toLowerCase().replace(/\s+/g, "_").replace(/[^\w_]/g, "");

        const keyword: Keyword = {
            id,
            word,
            lastUsedAt: new Date(0),
            timesUsed: 0,
            usageHistory: [],
        };

        const docRef = colRef.doc(id);
        batch.set(docRef, keyword);
    }

    await batch.commit();
    console.log(`✅ Imported ${words.length} keywords into guild ${guildId}`);
}

importKeywords(guildId, filePath).catch(console.error);
