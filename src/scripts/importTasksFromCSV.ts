import fs from "fs";
import path from "path";
import "dotenv/config";
import { createFirestore } from "../core/database/firestore.js";
import { TaskRepository } from "../core/database/TaskRepo.js";
import { importTasks, parseTasksCsv } from "../modules/tasks/TaskImport.js";

// CLI runner for local use
const guildId = process.env.DISCORD_GUILD_ID;
const filePath = path.resolve(process.cwd(), "data/tasks.csv");

if (!guildId) {
  console.error("❌ DISCORD_GUILD_ID missing from .env");
  process.exit(1);
}

importTasks(new TaskRepository(createFirestore(), guildId), parseTasksCsv(fs.readFileSync(filePath, "utf-8")))
  .then(({ newCount, skipped, total }) => {
    console.log(
      `📥 Finished processing ${total} rows for guild ${guildId} (new: ${newCount}, skipped: ${skipped})`
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Task import failed:", err);
    process.exit(1);
  });
