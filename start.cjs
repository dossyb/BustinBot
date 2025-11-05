// --- BUSTINBOT BOOTSTRAP ---
const { execSync } = require("child_process");
const fs = require("fs");

function run(cmd, allowFail = false) {
  console.log(`\n> ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (err) {
    if (allowFail) console.warn(`⚠️ Command failed (ignored): ${cmd}`);
    else throw err;
  }
}

const REPO = "https://github.com/dossyb/BustinBot.git";
const BRANCH = process.env.GIT_BRANCH || "main";

console.log("⚙️ Starting BustinBot startup...");

// --- Pull or clone repo ---
if (!fs.existsSync(".git")) {
  console.log("🧭 No .git found — cloning fresh repo...");
  run(`git clone -b ${BRANCH} ${REPO} .`);
} else {
  console.log("🧹 Resetting existing repo...");
  run("git reset --hard HEAD", true);
  run(`git clean -fdx -e data -e assets -e start.cjs -e .env -e .env.local`, true);
  run(`git fetch origin ${BRANCH}`, true);
  run(`git reset --hard origin/${BRANCH}`, true);
}

// --- Install dependencies ---
console.log("📦 Installing dependencies...");
run("npm ci --omit=dev", true);

// --- Clean old build ---
console.log("🧹 Removing old dist folder...");
fs.rmSync("dist", { recursive: true, force: true });

// --- Build the bot ---
console.log("🏗️ Building TypeScript...");
run("npm run build", true);

// --- Verify data folders ---
if (!fs.existsSync("data")) console.warn("⚠️ Missing /data folder!");
if (!fs.existsSync("assets")) console.warn("⚠️ Missing /assets folder!");

// --- Launch ---
console.log("🚀 Launching compiled bot...");
run("node dist/index.js");
