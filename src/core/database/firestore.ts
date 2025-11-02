import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { config as loadEnv } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { getDirname } from '../../utils/PathUtils.js';

loadEnv();

function loadServiceAccount(): admin.ServiceAccount | undefined {
    const raw = process.env.FIREBASE_SERVICE_KEY;

    if (raw) {
        // Allow either a JSON string or a filesystem path.
        const trimmed = raw.trim();
        if (trimmed.startsWith('{')) {
            try {
                return JSON.parse(trimmed) as admin.ServiceAccount;
            } catch (err) {
                throw new Error(`Failed to parse FIREBASE_SERVICE_KEY JSON: ${(err as Error).message}`);
            }
        }

        const resolvedPath = path.resolve(trimmed);
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`FIREBASE_SERVICE_KEY path does not exist: ${resolvedPath}`);
        }
        const fileContents = fs.readFileSync(resolvedPath, 'utf8');
        try {
            return JSON.parse(fileContents) as admin.ServiceAccount;
        } catch (err) {
            throw new Error(`Failed to parse service account JSON at ${resolvedPath}: ${(err as Error).message}`);
        }
    }

    // Fallback to bundled config for local scripts.
    const dirname = getDirname(import.meta.url);
    const defaultPath = path.resolve(dirname, '../../config/bustinbot-3840f-firebase-adminsdk-fbsvc-39e719dd30.json');
    if (fs.existsSync(defaultPath)) {
        const fileContents = fs.readFileSync(defaultPath, 'utf8');
        try {
            return JSON.parse(fileContents) as admin.ServiceAccount;
        } catch (err) {
            throw new Error(`Failed to parse default service account JSON: ${(err as Error).message}`);
        }
    }

    return undefined;
}

const serviceAccount = loadServiceAccount();

if (!serviceAccount) {
    throw new Error('FIREBASE_SERVICE_KEY is not configured and default service account file is missing.');
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

export const db = getFirestore();
