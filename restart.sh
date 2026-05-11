#!/bin/bash
set -e

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

# Load .env file to check variables
export $(grep -v '^#' .env | xargs)

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

# 1. Stop existing background processes
echo "🛑 Stopping existing processes..."
pkill -f "next dev" || true
pkill -f "tsx src/main.ts" || true

# 2. Stop docker containers
echo "🐳 Stopping Docker containers..."
docker-compose down || true

# 3. Start database
echo "🗄️  Starting PostgreSQL database..."
docker-compose up -d db

# Wait for database to be healthy
echo "⏳ Waiting for database to be ready..."
until docker exec mdas-db-1 pg_isready -U mdas -d mdas > /dev/null 2>&1; do
  echo "  Database not ready yet, waiting..."
  sleep 2
done
echo "✅ Database is ready"

# 4. Start web server
echo "🌐 Starting web server..."
npm run dev:web > /tmp/mdas-web.log 2>&1 &
WEB_PID=$!
echo "  Web server PID: $WEB_PID"

# Wait for web server to be ready
echo "⏳ Waiting for web server to be ready..."
WEB_READY=false
for i in {1..30}; do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    WEB_READY=true
    break
  fi
  sleep 1
done

if ! $WEB_READY; then
  echo "❌ Web server failed to become ready. Check logs: cat /tmp/mdas-web.log"
  kill $WEB_PID 2>/dev/null || true
  exit 1
fi
echo "✅ Web server is ready (PID: $WEB_PID)"

# 5. Start worker
echo "👷 Starting worker..."
npm run dev:worker > /tmp/mdas-worker.log 2>&1 &
WORKER_PID=$!
echo "  Worker PID: $WORKER_PID"

# Wait for worker to be ready
echo "⏳ Waiting for worker to be ready..."
sleep 5

# Check if processes are still running
if ! kill -0 $WEB_PID 2>/dev/null; then
  echo "❌ Web server died during startup. Check logs: cat /tmp/mdas-web.log"
  exit 1
fi

if ! kill -0 $WORKER_PID 2>/dev/null; then
  echo "❌ Worker failed to start. Check logs: cat /tmp/mdas-worker.log"
  echo "   Web server is still running at http://localhost:3000"
  exit 1
fi

echo "✅ Worker is running (PID: $WORKER_PID)"

echo ""
echo "🎉 Application restarted successfully!"
echo "   Web: http://localhost:3000"
echo "   Worker: running in background"
echo ""
echo "To view logs:"
echo "  Web:   tail -f /tmp/mdas-web.log"
echo "  Worker: tail -f /tmp/mdas-worker.log"
