#!/bin/bash
# bump.sh — write the build id (date + time) before a push
cd "$(dirname "$0")"
V=$(date +%Y%m%d-%H%M)
perl -i -pe "s/var APP_VER = '[^']*';/var APP_VER = '$V';/" index.html
perl -i -pe "s/sync-merge\\.js\\?v=[^\"']+/sync-merge.js?v=$V/" index.html
perl -i -pe "s/meal-shell-[0-9]+-[0-9]+/meal-shell-$V/" sw.js
echo "APP_VER=$V"
