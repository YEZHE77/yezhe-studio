#!/usr/bin/env bash
# 一键本地 UI 回归：起后端(4000) + 前端(5173) → 跑 puppeteer 截图 → 收尾
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# 1) 后端
PORT=4000 node server/src/index.js > /tmp/e2e-server.log 2>&1 &
SRV=$!
# 2) 前端
(cd client && npm run dev > /tmp/e2e-client.log 2>&1 &)

# 3) 等待端口就绪
echo "[run-local] 等待后端 4000 ..."
for i in $(seq 1 40); do
  if curl -s -o /dev/null http://localhost:4000/api/orders 2>/dev/null; then break; fi
  sleep 1
done
echo "[run-local] 等待前端 5173 ..."
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then break; fi
  sleep 1
done

# 4) 安装 puppeteer-core 并运行
cd "$ROOT/e2e"
echo "[run-local] 安装 puppeteer-core ..."
npm install --no-audit --no-fund >/dev/null 2>&1 || true
echo "[run-local] 运行视觉回归 ..."
BASE_URL=http://localhost:5173 node order-detail-visual.mjs

# 5) 收尾
kill $SRV 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
echo "[run-local] 已停止本地栈。"
