#!/bin/bash
set -e

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

echo "🔄 Restarting MDAS application..."

# Check if Docker is running
echo "🔍 Checking Docker status..."
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running!"
  echo ""
  echo "Please start Docker Desktop and try again:"
  echo "  - On macOS: Open Docker Desktop from Applications"
  echo "  - Wait for the Docker icon to show 'Docker Desktop is running'"
  echo "  - Then run this script again: ./restart.sh"
  echo ""
  exit 1
fi
echo "✅ Docker is running"

# Check for required environment variables
echo "🔍 Checking environment variables..."
if [ ! -f .env ]; then
  echo "❌ .env file not found!"
  echo ""
  echo "Please create a .env file from the example:"
  echo "  cp .env.example .env"
  echo ""
  echo "Then add your Glean credentials:"
  echo "  GLEAN_MCP_TOKEN=<your-bearer-token>"
  echo "  GLEAN_MCP_BASE_URL=https://api.glean.com"
  echo ""
  echo "See docs/integrations/glean.md for details on obtaining the token."
  echo ""
  exit 1
fi

# Load .env into this shell (and child processes). Avoid `export $(…|xargs)`
# — it breaks on values containing spaces or special characters.
set -a
# shellcheck disable=SC1091
source .env
set +a

if [ -z "$GLEAN_MCP_TOKEN" ] || [ -z "$GLEAN_MCP_BASE_URL" ]; then
  echo "❌ GLEAN_MCP_TOKEN or GLEAN_MCP_BASE_URL not set in .env!"
  echo ""
  echo "Please add them to your .env file:"
  echo "  GLEAN_MCP_TOKEN=<your-bearer-token>"
  echo "  GLEAN_MCP_BASE_URL=https://api.glean.com"
  echo ""
  echo "See docs/integrations/glean.md for details on obtaining the token."
  echo "Or run 'make glean-token' to refresh the token automatically."
  echo ""
  exit 1
fi
echo "✅ Environment variables configured"

# Stop docker containers (db only — web/worker run on host via scripts/local-dev.sh)
echo "🐳 Stopping Docker containers..."
docker-compose down || true

# Start database
echo "🗄️  Starting PostgreSQL database..."
docker-compose up -d db

# Wait for database to be healthy
echo "⏳ Waiting for database to be ready..."
until docker exec mdas-db-1 pg_isready -U mdas -d mdas > /dev/null 2>&1; do
  echo "  Database not ready yet, waiting..."
  sleep 2
done
echo "✅ Database is ready"

# Start web + worker (double-forked so they survive terminal close)
bash "$REPO_ROOT/scripts/local-dev.sh" start

echo ""
echo "🎉 Application restarted successfully!"
echo "   Web: http://localhost:3000"
echo "   Worker: running in background"
echo ""
echo "To view logs:"
echo "  Web:   tail -f /tmp/mdas-web.log"
echo "  Worker: tail -f /tmp/mdas-worker.log"
echo ""
echo "Status:  bash scripts/local-dev.sh status"
echo "Stop:    bash scripts/local-dev.sh stop"
echo ""
echo "Web + worker run in detached screen sessions (mdas-web, mdas-worker)"
echo "so they keep running after this terminal closes."
