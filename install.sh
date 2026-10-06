#!/bin/bash
# open-todos installer for macOS / Linux
set -e
SRC="$(cd "$(dirname "$0")" && pwd)/open-todos"
DEST="$HOME/.claude/mods/open-todos"
SETTINGS="$HOME/.claude/settings.json"

mkdir -p "$HOME/.claude/mods"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"

[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak-open-todos"

# CLAUDE_CODE_PLUGIN_DIRS is a ':'-separated list: keep the folders already there (e.g. token-usage) and add ours.
DEST="$DEST" SETTINGS="$SETTINGS" node -e '
const fs = require("fs"), p = process.env.SETTINGS, d = process.env.DEST;
const raw = fs.readFileSync(p, "utf8").trim();
const j = raw ? JSON.parse(raw) : {};
j.env = j.env || {};
const list = (j.env.CLAUDE_CODE_PLUGIN_DIRS || "").split(":").filter(Boolean);
if (!list.includes(d)) list.push(d);
j.env.CLAUDE_CODE_PLUGIN_DIRS = list.join(":");
j.env.CLAUDE_CODE_PLUGIN_DIR_WATCH = "1";
fs.writeFileSync(p, JSON.stringify(j, null, 2));
'

echo "已安裝到 $DEST"
echo "設定已更新（備份：$SETTINGS.bak-open-todos）"
echo "請完全關閉並重新開啟 Claude Desktop。"
