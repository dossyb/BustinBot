#!/bin/bash
set -e
export NODE_ENV=production

echo "⚙️ Starting manual startup process..."

# Only clone if .git is missing
if [[ ! -d .git ]]; then
  echo "🧭 No .git directory found — assuming first-time setup."
  if [ "$(ls -A .)" ]; then
    echo "⚠️ Directory not empty, skipping clone to avoid overwriting files."
  else
    echo "📦 Cloning repository..."
    git clone https://github.com/dossyb/BustinBot.git .
  fi
elif [[ "${AUTO_UPDATE}" == "1" ]]; then
  echo "🔄 Pulling latest changes..."
  git pull --rebase
else
  echo "✅ Repository already up to date or AUTO_UPDATE disabled."
fi

echo "📦 Installing production dependencies..."
npm ci --omit=dev || npm install --omit=dev

echo "🏗️ Building TypeScript..."
npm run build

echo "🚀 Launching bot..."
node dist/index.js
