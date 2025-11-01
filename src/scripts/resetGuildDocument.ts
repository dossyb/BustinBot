import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import path from 'path';
import fs from 'fs';

const args = process.argv.slice(2);
if (args.length < 1) {
    console.error('Usage: npx tsx src/scripts/resetGuildDocument.ts <GUILD_ID> [--keep]');
    process.exit(1);
}

const guildId = args[0];
const keepOriginal = args.includes('--keep');

// Load service account key (adjust if your key path differs)
const serviceAccountPath = './src/config/bustinbot-3840f-firebase-adminsdk-fbsvc-39e719dd30.json';
if (!fs.existsSync(serviceAccountPath)) {
    console.error(`Service account key not found at ${serviceAccountPath}`);
    process.exit(1);
}

// Initialize Firebase
initializeApp({
    credential: cert(path.resolve(serviceAccountPath)),
});

const db = getFirestore();

async function cloneGuildDocument(guildId: string) {
    const guildRef = db.collection('guilds').doc(guildId);
    const snapshot = await guildRef.get();

    if (!snapshot.exists) {
        console.error(`Guild document not found for ID: ${guildId}`);
        process.exit(1);
    }

    const data = snapshot.data();
    if (!data) {
        console.error(`Guild document is empty for ID: ${guildId}`);
        process.exit(1);
    }

    // Create a timestamped backup document ID
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = `${guildId}-backup-${timestamp}`;
    const backupRef = db.collection('guilds').doc(backupId);

    console.log(`🔄 Backing up guild ${guildId} → ${backupId}`);
    await backupRef.set(data);

    // Optional: copy subcollections too
    const subcollections = await guildRef.listCollections();
    for (const sub of subcollections) {
        console.log(`📂 Copying subcollection ${sub.id}...`);
        const docs = await sub.get();
        const batch = db.batch();

        for (const doc of docs.docs) {
            const subBackupRef = backupRef.collection(sub.id).doc(doc.id);
            batch.set(subBackupRef, doc.data());
        }

        await batch.commit();
    }

    if (!keepOriginal) {
        console.log(`🗑️  Deleting original guild document (${guildId})...`);
        await guildRef.delete();
    } else {
        console.log('⚠️  Keeping original guild document (--keep specified)');
    }

    console.log(`✅ Guild backup completed successfully: ${backupId}`);
}

cloneGuildDocument(guildId!)
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Error during guild reset:', err);
        process.exit(1);
    });