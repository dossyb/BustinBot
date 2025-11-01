import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import path from 'path';
import { getDirname } from 'utils/PathUtils';
const __dirname = getDirname(import.meta.url);

const serviceAccountPath = path.join(__dirname, '../../config/bustinbot-3840f-firebase-adminsdk-fbsvc-39e719dd30.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
    });
}

export const db = getFirestore();