import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { db } from "../core/database/firestore";
import { Timestamp } from "firebase-admin/firestore";
import "dotenv/config";

interface CsvRow {
  [key: string]: string | number | boolean | undefined;
}

function cleanUndefined(obj: Record<string, any>) {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
}

function toNumber(value: any): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.\-]/g, "").trim();
    const parsed = Number(cleaned);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, "_"); // turn "Min XP for Bronze" → "min_xp_for_bronze"
}

export async function importTasksFromCsv(guildId: string, filePath: string) {
  const csvData = fs.readFileSync(filePath, "utf-8");
  const records = parse<CsvRow>(csvData, {
    columns: (header) => header.map(normalizeKey),
    skip_empty_lines: true,
  });

  const colRef = db.collection(`guilds/${guildId}/tasks`);

  const existingSnapshot = await colRef.select("id").get();
  const existingIds = new Set(existingSnapshot.docs.map((d) => d.id));

  const batch = db.batch();
  let newCount = 0;
  let skipped = 0;

  for (const row of records) {
    const id = String(row["id"] ?? row["i_d"] ?? "").trim();
    if (!id) continue;

    if (existingIds.has(id)) {
      skipped++;
      continue;
    }

    const category = row["category"];
    const type = row["type"];
    const skill = row["skill"];
    const isSkilling = category === "Skilling" || !!skill;

    const task = {
      id,
      taskName: row["task_name"],
      category,
      type,
      skill,
      amtBronze: toNumber(row["bronze_amount"]) ?? 0,
      amtSilver: toNumber(row["silver_amount"]) ?? 0,
      amtGold: toNumber(row["gold_amount"]) ?? 0,
      weight: toNumber(row["weight"]) ?? 50,
      shortName: row["short_name"],
      wildernessReq:
        row["wilderness_required?"] === "TRUE" ||
        row["wildernessreq"] === "TRUE" ||
        row["wilderness_required?"] === true,
      createdAt: Timestamp.now(),

      ...(isSkilling && {
        xpPerAction: toNumber(row["xp_per_action"]),
        minXPBronze: toNumber(row["min_xp_for_bronze"]),
        minXPSilver: toNumber(row["min_xp_for_silver"]),
        minXPGold: toNumber(row["min_xp_for_gold"]),
      }),
    };

    const docRef = colRef.doc(id);
    batch.set(docRef, cleanUndefined(task));
    newCount++;
  }

  if (newCount > 0) {
    await batch.commit();
  }

  console.log(`✅ ${newCount} new tasks imported, ${skipped} skipped (already exist).`);
  return { newCount, skipped, total: records.length };
}

// CLI runner for local use
if (process.argv[1]!.includes("importTasksFromCsv")) {
  const guildId = process.env.DISCORD_GUILD_ID!;
  const filePath = path.resolve("./src/data/tasks.csv");

  if (!guildId) {
    console.error("❌ DISCORD_GUILD_ID missing from .env");
    process.exit(1);
  }

  importTasksFromCsv(guildId, filePath).catch(console.error);
}