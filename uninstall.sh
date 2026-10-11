#!/bin/bash
# open-todos uninstaller for macOS / Linux: removes the mod, its settings entry, its data files,
# and revokes the Google Tasks sign-in so the next user of this account cannot reach your tasks.
set -e
DEST="$HOME/.claude/mods/open-todos"
SETTINGS="$HOME/.claude/settings.json"
AUTH="$HOME/.claude/open-todos-gtasks-auth.json"

# revoke before deleting the token; the task lists made in Google Tasks stay in that Google account
if [ -f "$AUTH" ]; then
  AUTH="$AUTH" node -e '
const a = JSON.parse(require("fs").readFileSync(process.env.AUTH, "utf8"));
fetch("https://oauth2.googleapis.com/revoke", { method: "POST", body: new URLSearchParams({ token: a.refresh_token }) })
  .then(r => console.log(r.ok ? "已撤銷 Google 授權" : "撤銷失敗（" + r.status + "），請到 https://myaccount.google.com/permissions 手動移除"))
  .catch(() => console.log("無法連線撤銷，請到 https://myaccount.google.com/permissions 手動移除"));
'
fi

if [ -f "$SETTINGS" ]; then
  cp "$SETTINGS" "$SETTINGS.bak-open-todos-uninstall"
  # take only our folder out of CLAUDE_CODE_PLUGIN_DIRS; other mods (and the watch flag they use) stay
  DEST="$DEST" SETTINGS="$SETTINGS" node -e '
const fs = require("fs"), p = process.env.SETTINGS, d = process.env.DEST;
const j = JSON.parse(fs.readFileSync(p, "utf8").trim() || "{}");
if (j.env && j.env.CLAUDE_CODE_PLUGIN_DIRS !== undefined) {
  const list = j.env.CLAUDE_CODE_PLUGIN_DIRS.split(":").filter(x => x && x !== d);
  if (list.length) j.env.CLAUDE_CODE_PLUGIN_DIRS = list.join(":");
  else { delete j.env.CLAUDE_CODE_PLUGIN_DIRS; delete j.env.CLAUDE_CODE_PLUGIN_DIR_WATCH }
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}
'
fi

rm -rf "$DEST"
rm -f "$HOME"/.claude/open-todos-*

echo "已移除 open-todos（設定備份：$SETTINGS.bak-open-todos-uninstall）"
echo "請重新開啟 Claude Code。"
