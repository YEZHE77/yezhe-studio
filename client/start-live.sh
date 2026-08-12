#!/bin/bash
# ============================================================
# 生产实时数据模式启动脚本（前端 dev + 模拟器预览）
#
# 作用：把前端 dev server 的 /api 代理指向线上生产后端
#       https://yezhe-studio-server.onrender.com（Neon 生产库），
#       让手机模拟器（localhost:5555）显示与手机端完全一致的实时数据。
#
# 注意：
#   - 此模式下所有登录后的操作（增删改、删除等）会【实时写入生产数据库】，
#     与手机上操作完全等价，请谨慎操作。
#   - 想切回本地演示库（localhost:4000），直接执行 `npm run dev` 即可。
# ============================================================
cd "$(dirname "$0")"
echo "🌐 已切换到【生产实时数据】模式：API → https://yezhe-studio-server.onrender.com"
echo "   刷新模拟器 http://localhost:5555 即可看到生产数据"
VITE_API_TARGET=https://yezhe-studio-server.onrender.com npm run dev
