import "dotenv/config";
import { createFirestore } from "../core/database/firestore.js";

const db = createFirestore();

async function test() {
    const docRef = db.collection("test").doc("ping");
    await docRef.set({ message: "pong", time: new Date() });
    console.log("Test document written successfully!");
}

test();