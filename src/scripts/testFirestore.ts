import { db } from "../core/database/firestore.js";

async function test() {
    const docRef = db.collection("test").doc("ping");
    await docRef.set({ message: "pong", time: new Date() });
    console.log("Test document written successfully!");
}

test();