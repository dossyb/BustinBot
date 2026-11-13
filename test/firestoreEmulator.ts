import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { MockAgent } from "undici";
import { FIRESTORE_SETTINGS } from "../src/core/database/firestore.js";

const APP_NAME = "firestore-emulator-tests";

export const CONCURRENT_TRANSACTION_TIMEOUT_MS = 35_000;

// The emulator can't be made to fail one read or write, so a test makes one repository call fail with this, the
// error an unreachable Firestore gives
export function firestoreUnavailable(): Error {
    return Object.assign(new Error("14 UNAVAILABLE: No connection established"), { code: 14 });
}

// undici doesn't set a content type on a mocked reply, and without one the reply is read as bytes, not JSON
export const JSON_REPLY = { headers: { "content-type": "application/json" } };

export function offlineAgent(): MockAgent {
    const agent = new MockAgent();
    agent.disableNetConnect();
    if (process.env.FIRESTORE_EMULATOR_HOST) agent.enableNetConnect(process.env.FIRESTORE_EMULATOR_HOST);
    return agent;
}

function emulatorTarget(): { host: string; projectId: string } {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (!host) {
        throw new Error(
            "FIRESTORE_EMULATOR_HOST is not set. Run integration tests with `npm test`, which starts the Firestore emulator.",
        );
    }

    const projectId = process.env.GCLOUD_PROJECT ?? "";
    if (!projectId.startsWith("demo-")) {
        throw new Error(`Refusing to run against project "${projectId}": emulator tests must use a demo- project.`);
    }

    return { host, projectId };
}

export function newEmulatorDatabase(): Firestore {
    const { projectId } = emulatorTarget();
    const app = getApps().find((existing) => existing.name === APP_NAME) ?? initializeApp({ projectId }, APP_NAME);
    const db = getFirestore(app, `test-${randomUUID()}`);
    db.settings(FIRESTORE_SETTINGS);
    return db;
}
