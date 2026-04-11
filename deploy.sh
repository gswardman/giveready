#!/usr/bin/env bash
set -euo pipefail

# GiveReady — single-command deploy
#
# Usage:
#   ./deploy.sh "commit message here"     Full deploy: git + wrangler + MCP
#   ./deploy.sh --skip-mcp "message"      Skip MCP registry publish
#   ./deploy.sh --dry-run "message"       Show what would happen, change nothing
#   ./deploy.sh --rollback                Reset to the previous deploy tag
#
# What it does:
#   1. Check for uncommitted changes
#   2. Stage all tracked + new files (respects .gitignore)
#   3. Commit with your message
#   4. Tag with timestamp (for rollback)
#   5. Push to GitHub
#   6. Deploy to Cloudflare (wrangler deploy)
#   7. Publish MCP server to registry
#   8. Verify live endpoints

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DRY_RUN=false
SKIP_MCP=false
ROLLBACK=false
MESSAGE=""

for arg in "$@"; do
  case $arg in
    --dry-run)   DRY_RUN=true ;;
    --skip-mcp)  SKIP_MCP=true ;;
    --rollback)  ROLLBACK=true ;;
    *)           MESSAGE="$arg" ;;
  esac
done

# ── ROLLBACK ──
if [ "$ROLLBACK" = true ]; then
  echo "=== GiveReady Rollback ==="
  echo ""
  # Find the second-most-recent deploy tag (most recent is current)
  TAGS=$(git tag --sort=-creatordate | grep "^deploy-" | head -2)
  CURRENT=$(echo "$TAGS" | head -1)
  PREVIOUS=$(echo "$TAGS" | tail -1)

  if [ -z "$PREVIOUS" ] || [ "$CURRENT" = "$PREVIOUS" ]; then
    echo "No previous deploy tag found. Nothing to roll back to."
    echo "Available tags:"
    git tag --sort=-creatordate | grep "^deploy-" || echo "  (none)"
    exit 1
  fi

  echo "Current:  $CURRENT"
  echo "Rolling back to: $PREVIOUS"
  echo ""
  read -p "Continue? (y/n) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi

  git reset --hard "$PREVIOUS"
  git push origin main --force-with-lease
  wrangler deploy
  echo ""
  echo "Rolled back to $PREVIOUS and redeployed."
  exit 0
fi

# ── NORMAL DEPLOY ──
if [ -z "$MESSAGE" ]; then
  echo "Usage: ./deploy.sh \"your commit message\""
  echo "       ./deploy.sh --dry-run \"your commit message\""
  echo "       ./deploy.sh --rollback"
  exit 1
fi

echo "=== GiveReady Deploy ==="
echo ""

# 1. Prerequisites
echo "[1/8] Checking prerequisites..."
command -v wrangler >/dev/null 2>&1 || { echo "Error: wrangler not found. Run: npm install -g wrangler"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "Error: git not found."; exit 1; }

# 2. Clean lock files
rm -f .git/index.lock

# 3. Install deps
echo "[2/8] Installing dependencies..."
npm install --silent 2>/dev/null

# 4. Stage everything (respects .gitignore)
echo "[3/8] Staging files..."
git add -A

# Show what's staged
STAGED=$(git diff --cached --stat)
if [ -z "$STAGED" ]; then
  echo "  Nothing to commit. Already up to date."
  echo ""
  echo "  Deploy only? Running wrangler deploy..."
  wrangler deploy
  echo "  Done."
  exit 0
fi
echo "$STAGED" | sed 's/^/  /'

# 5. Safety check — no secrets
echo ""
echo "[4/8] Checking for sensitive files..."
SECRETS=$(git diff --cached --name-only | grep -iE "\.env|secret|token|credential|\.pem|\.key" | grep -v ".gitignore" || true)
if [ -n "$SECRETS" ]; then
  echo "  WARNING: These files look sensitive:"
  echo "$SECRETS" | sed 's/^/    /'
  echo ""
  read -p "  Continue anyway? (y/n) " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted. Unstage sensitive files with: git reset HEAD <file>"
    exit 1
  fi
else
  echo "  Clean."
fi

# 6. Tag + Commit
DEPLOY_TAG="deploy-$(date +%Y%m%d-%H%M%S)"
echo ""
echo "[5/8] Committing: $MESSAGE"

if [ "$DRY_RUN" = true ]; then
  echo "  [dry run] Would commit with message: $MESSAGE"
  echo "  [dry run] Would tag: $DEPLOY_TAG"
  echo "  [dry run] Would push to origin/main"
  echo "  [dry run] Would run: wrangler deploy"
  [ "$SKIP_MCP" = false ] && echo "  [dry run] Would publish MCP server"
  echo ""
  echo "Dry run complete. No changes made."
  git reset HEAD . >/dev/null 2>&1
  exit 0
fi

git commit -m "$MESSAGE

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

git tag "$DEPLOY_TAG"

# 7. Push
echo "[6/8] Pushing to GitHub..."
git push origin main
git push origin "$DEPLOY_TAG"

# 8. Run any pending migrations
echo "[7/8] Running migrations..."
for migration in migrations/*.sql; do
  [ -f "$migration" ] && {
    echo "  Running $migration..."
    wrangler d1 execute giveready-db --file="$migration" --remote 2>/dev/null || echo "  (already applied or skipped)"
  }
done

# 9. Deploy to Cloudflare
echo "[8/9] Deploying to Cloudflare..."
wrangler deploy

# 10. MCP registry
if [ "$SKIP_MCP" = false ]; then
  echo "[9/9] Publishing MCP server..."
  if [ -d "mcp-server" ] && command -v mcp-publisher >/dev/null 2>&1; then
    (cd mcp-server && mcp-publisher publish 2>/dev/null) || echo "  MCP publish skipped (not logged in or error)"
  else
    echo "  Skipped (mcp-publisher not found or no mcp-server dir)"
  fi
else
  echo "[9/9] Skipping MCP publish (--skip-mcp)"
fi

# 10. Verify
echo ""
echo "Verifying live site..."
sleep 2
for url in "https://giveready.org/" "https://giveready.org/api/stats" "https://giveready.org/llms.txt"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  echo "  $url → $STATUS"
done

echo ""
echo "=== Deployed as $DEPLOY_TAG ==="
echo "Rollback: ./deploy.sh --rollback"
