import fs from 'fs';
import path from 'path';
import { Pool } from 'undici';

const keywordsPath = path.resolve(process.cwd(), 'src/data/keywords.json');
const usedPath = path.resolve(process.cwd(), 'src/data/usedKeywords.json');
const HISTORY_LIMIT = 26;

function loadKeywords(): string[] {
    if (!fs.existsSync(keywordsPath)) {
        throw new Error('Keywords file not found.');
    }
    return JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));
}

function loadUsedKeywords(): string[] {
    if (!fs.existsSync(usedPath)) return [];
    return JSON.parse(fs.readFileSync(usedPath, 'utf-8'));
}

function saveUsedKeywords(updated: string[]) {
    fs.writeFileSync(usedPath, JSON.stringify(updated.slice(0, HISTORY_LIMIT), null, 2));
}

export function selectKeyword(): string {
    const all = loadKeywords();
    const used = loadUsedKeywords();

    const available = all.filter(k => !used.includes(k));

    // If all keywords used recently, reset history
    const pool = available.length > 0 ? available : all;

    if (pool.length === 0) {
        console.warn('[KeywordSelector] No keywords available. Returning fallback.');
        return 'keyword';
    }

    const chosen = pool[Math.floor(Math.random() * pool.length)]!;

    // Update history
    const updatedHistory: string[] = [chosen, ...used.filter(k => k !== chosen)];
    saveUsedKeywords(updatedHistory);

    console.log(`[KeywordSelector] Selected keyword: ${chosen}`);
    return chosen;
}