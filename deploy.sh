#!/bin/bash
# deploy.sh — 构建并部署 dsh-obsidian 到 Obsidian vault
# 用法: ./deploy.sh <vault路径> [--dev]
# 例:  ./deploy.sh ~/Documents/MyVault

set -e
cd "$(dirname "$0")"

DEV=false
VAULT=""
for arg in "$@"; do
  if [ "$arg" = "--dev" ] || [ "$arg" = "-d" ]; then DEV=true; else VAULT="$arg"; fi
done

if [ -z "$VAULT" ]; then
  echo "用法: ./deploy.sh <vault路径> [--dev]"
  exit 1
fi

if [ "$DEV" = true ]; then
  npm run dev
else
  npm run build
fi

DEST="$VAULT/.obsidian/plugins/dsh-obsidian"
mkdir -p "$DEST"
cp dist/main.js dist/manifest.json dist/styles.css "$DEST/"
echo "已部署到 $DEST — 在 Obsidian 中重新加载并启用插件"
