#!/bin/bash
# Deploy Google Apps Script and auto-update Railway GAS_WEBHOOK_URL
# Usage: ./scripts/deploy-gas.sh "Description of changes"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAS_DIR="$SCRIPT_DIR/google_apps_script"

# Check for description
if [ -z "$1" ]; then
  echo "Usage: ./scripts/deploy-gas.sh \"Description of changes\""
  exit 1
fi

DESCRIPTION="$1"

echo "📤 Pushing Code.gs to Google Apps Script..."
cd "$GAS_DIR"
npx clasp push

echo ""
echo "🚀 Creating new deployment: $DESCRIPTION"
DEPLOY_OUTPUT=$(npx clasp deploy --description "$DESCRIPTION" 2>&1)
echo "$DEPLOY_OUTPUT"

# Extract the deployment URL from output
# Format: "Deployed AKfycby... @XX"
DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | grep -oE 'AKfycb[a-zA-Z0-9_-]+')

if [ -z "$DEPLOY_ID" ]; then
  echo "❌ Failed to extract deployment ID"
  exit 1
fi

# Build the full webhook URL
WEBHOOK_URL="https://script.google.com/macros/s/${DEPLOY_ID}/exec"

echo ""
echo "📋 New deployment URL:"
echo "   $WEBHOOK_URL"

# Check if Railway CLI is available
if ! command -v railway &> /dev/null; then
  echo ""
  echo "⚠️  Railway CLI not found. Install with: npm install -g @railway/cli"
  echo ""
  echo "Manual update required:"
  echo "   GAS_WEBHOOK_URL=$WEBHOOK_URL"
  exit 0
fi

echo ""
echo "🔄 Updating Railway GAS_WEBHOOK_URL..."

# Update Railway environment variable
# Note: This requires being logged into Railway CLI and having the project linked
railway variables set GAS_WEBHOOK_URL="$WEBHOOK_URL" 2>/dev/null || {
  echo ""
  echo "⚠️  Could not update Railway automatically."
  echo "   Make sure you're logged in (railway login) and project is linked (railway link)"
  echo ""
  echo "Manual update required in Railway dashboard:"
  echo "   GAS_WEBHOOK_URL=$WEBHOOK_URL"
  exit 0
}

echo "✅ Railway GAS_WEBHOOK_URL updated successfully!"
echo ""
echo "🔄 Triggering Railway redeploy..."
railway up --detach 2>/dev/null || {
  echo "   (Railway will auto-deploy on next git push)"
}

echo ""
echo "✅ Deployment complete!"
echo "   GAS Version: $DEPLOY_ID"
echo "   URL: $WEBHOOK_URL"
