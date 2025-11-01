import fs from 'fs';
import path from 'path';
import { db } from '../core/database/firestore.js';
import { Timestamp } from 'firebase-admin/firestore';
import 'dotenv/config';

const filePath = path.resolve('./src/data/keywords.json');

const guildId = process.env.DISCORD_GUILD_ID;
if (!guildId) {
    console.error('DISCORD_GUILD_ID missing from .env');
    process.exit(1);
}

function cleanUndefined(obj: Record<string, any>) {
    return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}

async function importKeywords(guildId: string, filePath: string) {
    const data = fs.readFileSync(filePath, 'utf-8');
    const words = JSON.parse(data) as string[];

    if (!Array.isArray(words)) {
        throw new Error('Invalid keywords.json format: expected an array of strings');
    }

    const colRef = db.collection(`guilds/${guildId}/keywords`);
    const batch = db.batch();

    console.log(`Found ${words.length} keywords`);

    for (const word of words) {
        const id = word.toLowerCase().replace(/\s+/g, "_").replace(/[^\w_]/g, "");

        const keyword = cleanUndefined({
            id,
            word,
            lastUsedAt: Timestamp.fromMillis(0),
            timesUsed: 0,
            usageHistory: [],
        });

        const docRef = colRef.doc(id);
        batch.set(docRef, keyword);
    }

    await batch.commit();
    console.log(`✅ Imported ${words.length} keywords into guild ${guildId}`);
}

importKeywords(guildId, filePath).catch(console.error);