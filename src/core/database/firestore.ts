import { initializeApp, cert, getApps, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type Firestore, type Settings } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

export const FIRESTORE_SETTINGS: Settings = { ignoreUndefinedProperties: true };

function loadServiceAccount(): ServiceAccount | undefined {
    const raw = process.env.FIREBASE_SERVICE_KEY;

    if (raw) {
        // Allow either a JSON string or a filesystem path.
        const trimmed = raw.trim();
        if (trimmed.startsWith("{")) {
            try {
                return JSON.parse(trimmed) as ServiceAccount;
            } catch (err) {
                throw new Error("Failed to parse FIREBASE_SERVICE_KEY JSON", { cause: err });
            }
        }

        const resolvedPath = path.resolve(trimmed);
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`FIREBASE_SERVICE_KEY path does not exist: ${resolvedPath}`);
        }
        const fileContents = fs.readFileSync(resolvedPath, "utf8");
        try {
            return JSON.parse(fileContents) as ServiceAccount;
        } catch (err) {
            throw new Error(`Failed to parse service account JSON at ${resolvedPath}`, { cause: err });
        }
    }

    // Fallback to bundled config for local scripts.
    const defaultPath = path.resolve(import.meta.dirname, "../../config/bustinbot-3840f-firebase-adminsdk-fbsvc-39e719dd30.json");
    if (fs.existsSync(defaultPath)) {
        const fileContents = fs.readFileSync(defaultPath, "utf8");
        try {
            return JSON.parse(fileContents) as ServiceAccount;
        } catch (err) {
            throw new Error("Failed to parse default service account JSON", { cause: err });
        }
    }

    return undefined;
}

export function createFirestore(): Firestore {
    if (!getApps().length) {
        const serviceAccount = loadServiceAccount();
        if (!serviceAccount) {
            throw new Error("FIREBASE_SERVICE_KEY is not configured and default service account file is missing.");
        }

        const app = initializeApp({
            credential: cert(serviceAccount),
        });
        const db = getFirestore(app);
        db.settings(FIRESTORE_SETTINGS);
        return db;
    }

    return getFirestore();
}
