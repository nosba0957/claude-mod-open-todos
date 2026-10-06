# open-todos

Claude Desktop（Code 分頁）側欄面板：列出你所有 Claude Code session 中未完成與進行中的待辦，依專案分組。輸入 `/todos` 開啟與重新整理。Claude 建立或更新待辦、每個回合結束、送出 prompt 時會自動更新，另外每 20 秒檢查一次其他 session 的變動。

## 安裝
- macOS：`bash install.sh`
- Windows：在 PowerShell 執行 `powershell -ExecutionPolicy Bypass -File install.ps1`

完成後完全關閉並重開 Claude Desktop。腳本會備份並合併 `~/.claude/settings.json`（只在 `env` 內新增或補上兩個變數；已有的 `CLAUDE_CODE_PLUGIN_DIRS`，例如 token-usage，會保留）。

## 需求
- 支援 mod 功能的新版 Claude Code / Claude Desktop（開發時為 2.1.290）
- 電腦上有 `node`（掃描程式用它讀 session 紀錄）
- 待辦：只會顯示用過 Claude 待辦工具（TaskCreate / TodoWrite）建立的項目
- 執行中：最近 5 分鐘內有寫入紀錄的 session 會標示「執行中」，即使它沒有待辦，並顯示最後一則 prompt 和正在使用的工具

## 隱藏不想看的專案
專案資料夾已經刪除的專案會自動略過（Claude 的 session 紀錄不會隨資料夾一起刪除）。claude-mem 外掛在背景開的 `observer-sessions` 也會自動略過。其他想隱藏的：
在 `~/.claude/open-todos-ignore.txt` 一行寫一個要略過的項目（專案名稱、專案資料夾路徑，或 8 碼 session 編號），`#` 開頭是註解。不會動到 session 的紀錄檔，刪掉那一行就會重新出現。

## 更新
重新執行一次安裝腳本即可。

## 解除安裝
刪除 `~/.claude/mods/open-todos`，並從 `settings.json` 的 `env.CLAUDE_CODE_PLUGIN_DIRS` 移除該路徑。
