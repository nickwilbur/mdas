#!/bin/bash
set -e

echo "🔄 Restarting MDAS application..."

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

# 5. Start worker
echo "👷 Starting worker..."
npm run dev:worker > /tmp/mdas-worker.log 2>&1 &
WORKER_PID=$!
echo "  Worker PID: $WORKER_PID"

# Wait a moment for services to start
sleep 3

# Check if processes are still running
if kill -0 $WEB_PID 2>/dev/null; then
  echo "✅ Web server started successfully (PID: $WEB_PID)"
  echo "   Logs: tail -f /tmp/mdas-web.log"
else
  echo "❌ Web server failed to start. Check logs: cat /tmp/mdas-web.log"
  exit 1
fi

if kill -0 $WORKER_PID 2>/dev/null; then
  echo "✅ Worker started successfully (PID: $WORKER_PID)"
  echo "   Logs: tail -f /tmp/mdas-worker.log"
else
  echo "❌ Worker failed to start. Check logs: cat /tmp/mdas-worker.log"
  exit 1
fi

echo ""
echo "🎉 Application restarted successfully!"
echo "   Web: http://localhost:3000"
echo "   Worker: running in background"
echo ""
echo "To view logs:"
echo "  Web:   tail -f /tmp/mdas-web.log"
echo "  Worker: tail -f /tmp/mdas-worker.log"
