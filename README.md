# BustinBot

**BustinBot** is a modular Discord bot built to power community events and engagement through it's two modules: a movie night manager and an Old School RuneScape community task manager. Its name and theme take inspiration from Ghostbusters, reflecting its mission to “bust” the ghosts of menial upkeep and keep communities lively and organized.

---

## ⚙️ Overview

BustinBot is designed for **scalable community management** with a focus on **automation, scheduling and functional UI**. All modules operate independently but share a unified service container and Firestore-based persistence layer.

### 🎥 Movie Module
- Allows members to **add movies** to a shared watchlist, **vote** for the next movie and **watch** together at a scheduled time.
- Admins can schedule a **date/time** for movie night anytime two weeks into the future and select movies either via search, random roll or a random/curated poll of up to 5 options.
- Each movie has a rich embed powered by **TMDb** metadata.
- Automatically archives completed movie nights and notifies the movie submitter via DM when their movie has been selected or archived.

### 🗺️ Task Module
- Automates weekly **Old School RuneScape** challenges categorised by PvM, Skilling, and Minigame/Misc.
- Polls run every Sunday for 24 hours to determine the following week's tasks.
- Tasks for each category run for a week starting Monday with three tiers of completion - Bronze, Silver and Gold.
- Each successive tier corresponds to extra rolls in the fortnightly prize draw (every second Tuesday), incentivising participation.
- Task submissions are verified using a screenshot and keyword system to ensure progress is only made during the event period.
- Submissions are made via attachment uploads to the bot via DM which is forwarded to a private verification channel for admins to review and approve/reject.

## 🚀 Deployment

BustinBot supports **development** and **production** modes, with instant guild command registration for dev and global propagation for production.

### Prequisites
- **Node.js** v20+
- **npm** or **pnpm**
- **Firestore** database configured with appropriate service account credentials
- **Discord bot token** and application client ID

### Environment Variables

Create a `.env` file in the root directory:

```bash
DISCORD_TOKEN_DEV=your_dev_bot_token_here
DISCORD_TOKEN_LIVE=your_live_bot_token_here
DISCORD_CLIENT_ID_DEV=your_dev_client_id_here
DISCORD_CLIENT_ID=your_live_client_id_here
DISCORD_GUILD_ID=your_test_server_id_here
BOT_MODE=dev # or 'prod'
TMDB_API_KEY=your_tmdb_api_key_here
```

### Installation
```bash
npm install
```

### Running Locally
```bash
npm run dev
```

This launches the bot with **guild-level command registration** for instant testing.

### 🚀 Deploying to Production

1. **Set environment variables**

   In your `.env` file (or platform dashboard), ensure at least:

   ```env
   BOT_MODE=prod
   ```

2. **Choose your hosting platform**

   BustinBot runs on any Node.js 20+ environment with Git access.  
   Common options include **Cybrancee**, **Pterodactyl**, **Railway**, and **Render**.

3. **Set your startup command**

   Configure the host’s entry point to:

   ```bash
   node start.cjs
   ```

   The bootstrap script will:
   - Clone or update the repository from GitHub (branch from `GIT_BRANCH`)
   - Preserve your `/data` and `/assets` folders (safe from `git clean`)
   - Install dependencies (`npm ci --omit=dev`)
   - Build the TypeScript source into `/dist`
   - Launch the compiled bot (`node dist/index.js`)

4. **Verify initial setup**

   After the bot is online, confirm that global commands have propagated (this may take up to **60 minutes**).  
   Then, in your desired guild, run:

   ```
   /setup
   ```

   to complete configuration.

5. **Announce availability**

   Once setup and data imports are complete, run:

   ```
   /announce
   ```

   to let your server users know BustinBot is live and ready.

---

**Redeploys:**  
You can safely redeploy by restarting the container — `start.cjs` will automatically pull, rebuild, and relaunch the latest version of your configured branch without touching untracked runtime data.

**Data safety:**  
The bootstrap uses:

```bash
git clean -fdx -e data -e assets -e start.cjs
```

so your runtime data and assets are preserved between updates.

## Attributions
- [TMDb](https://www.themoviedb.org/) - Movie metadata and posters
- [Freepik](https://www.freepik.com/) - Task category thumbnails
- [Old School RuneScape](https://oldschool.runescape.com/) - Inspiration for weekly task system (fan-made, non-affiliated)

## Developer Notes
- Written in **TypeScript** using **Discord.js v14**.
- Includes comprehensive test coverage via **Vitest**.
- Supports both manual and automated Firestore import/export scripts.
- Designed for future modular expansion.

## License
This project is distributed under the MIT License.