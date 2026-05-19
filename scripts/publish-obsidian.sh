#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Obsidian launches this via execFile and does not inherit shell PATH,
# so nvm-managed node is not visible. Load nvm explicitly when present.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  set +u
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  set -u
fi

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

node scripts/sync-obsidian.js
./.bin/hugo --minify

# GitHub Actions builds and deploys public/ on the server side. Keep the local
# worktree focused on source files after using Hugo only as a verification step.
git restore public
git clean -fd -- public

if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain -- content/posts/yiqunshuo static/images/obsidian scripts/sync-obsidian.js docs/obsidian-sync.md)" ]; then
  echo "No blog changes to publish."
  exit 0
fi

git add content/posts/yiqunshuo static/images/obsidian scripts/sync-obsidian.js scripts/publish-obsidian.sh docs/obsidian-sync.md

if git diff --cached --quiet; then
  echo "No staged blog changes to publish."
  exit 0
fi

git commit -m "Sync Obsidian posts"
git push origin main

echo "Published Obsidian posts to https://luisy92.win/"
