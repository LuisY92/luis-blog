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

# Refresh the WeChat album cache used to cross-check issue numbers. The endpoint
# is unofficial, so a failure here must never block publishing.
node scripts/refresh-wechat-albums.js || echo "WeChat album refresh skipped."

node scripts/sync-obsidian.js

# A text cover for the newest post, for 公众号 pushes of posts that have no
# picture of their own. Lands in Hermes/outputs; never blocks publishing.
/usr/bin/python3 scripts/make-cover.py || echo "Cover skipped."

./.bin/hugo --minify

# GitHub Actions builds and deploys public/ on the server side. Keep the local
# worktree focused on source files after using Hugo only as a verification step.
git restore public
git clean -fd -- public

PUBLISH_PATHS=(content/posts static/images/obsidian data/wechat_albums.json scripts docs)

if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain -- "${PUBLISH_PATHS[@]}")" ]; then
  echo "No blog changes to publish."
  exit 0
fi

git add "${PUBLISH_PATHS[@]}"

if git diff --cached --quiet; then
  echo "No staged blog changes to publish."
  exit 0
fi

git commit -m "Sync Obsidian posts"
git push origin main

echo "Published Obsidian posts to https://luisy92.win/"
