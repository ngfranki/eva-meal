#!/bin/bash
# bump.sh — 每次 push 前自動寫入版本號（日期＋時間）
cd "$(dirname "$0")"
V=$(date +%Y%m%d-%H%M)
sed -i '' -E "s/var APP_VER = '[^']*';/var APP_VER = '$V';/" index.html
echo "APP_VER=$V"
