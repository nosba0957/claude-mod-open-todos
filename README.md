# open-todos

A side pane for Claude Desktop (Code tab) that lists the unfinished and in-progress todos from all your Claude Code sessions, grouped by project. Type `/todos` to open and refresh it. It updates automatically when Claude creates or updates a todo, at the end of each turn, and when you send a prompt, and checks other sessions for changes every 20 seconds. Optionally syncs with Google Tasks.

## Install
- macOS / Linux: `bash install.sh`
- Windows: in PowerShell, `powershell -ExecutionPolicy Bypass -File install.ps1`

Then fully quit and reopen Claude Desktop. The script backs up and merges `~/.claude/settings.json` (it only adds two variables under `env`; an existing `CLAUDE_CODE_PLUGIN_DIRS`, e.g. token-usage, is kept).

## Requirements
- A recent Claude Code / Claude Desktop with mod support (developed on 2.1.290)
- `node` on your machine (the scanner uses it to read session records)
- Todos: only items created with Claude's todo tools (TaskCreate / TodoWrite) are shown
- Running: a session that wrote to its record in the last 5 minutes is marked "running", even without todos, with its last prompt and current tool

## Hiding projects
Projects whose folder has been deleted are skipped automatically (Claude keeps session records after the folder is gone), as are the background `observer-sessions` of the claude-mem plugin. To hide others, put one entry per line in `~/.claude/open-todos-ignore.txt`: a project name, a project folder path, or an 8-character session id. Lines starting with `#` are comments. Session records are not touched; delete the line and the item comes back.

## Google Tasks sync (optional)
Once set up, the pane syncs with your Google account at most every 2 minutes:
- Open todos are pushed to Google Tasks, one task list per project.
- Completing or deleting a task in Google hides it in the pane; renaming it shows the new title.
- Tasks added in Google, and your own Google lists (e.g. "My Tasks"), appear in the pane as extra groups.
- Todos finished by Claude are ticked off in Google.

Claude's own session todo lists are never changed: a task ticked off in Google is only hidden in the pane. The "in progress" state is not synced (Google Tasks has none).

### Setup (once)
1. Create a Google Cloud project: https://console.cloud.google.com/projectcreate
2. Enable the Tasks API: https://console.cloud.google.com/apis/library/tasks.googleapis.com
3. Configure the OAuth consent screen: https://console.cloud.google.com/auth/overview
   User type "External". Under "Audience", add your Gmail address as a test user.
4. Create a client: https://console.cloud.google.com/auth/clients
   Application type "Desktop app". Download the JSON and save it on this machine, e.g. as `~/.claude/open-todos-gtasks-client.json`.
5. Sign in:
   ```
   node ~/.claude/mods/open-todos/hooks/gtasks-setup.js ~/.claude/open-todos-gtasks-client.json
   ```
   Open the printed URL and sign in. Google warns the app is unverified: choose "Advanced" → "Go to … (unsafe)". If the browser ends on a "can't reach this site" page (e.g. over SSH), paste that page's full URL into the terminal. Keep the command running until it says it is done.

### Renewing the sign-in
While the app is in "Testing" mode, Google expires the sign-in every 7 days. The pane then shows a red "Google 同步失敗" (Google sync failed) line. Run step 5 again; the client JSON stays valid. Publishing the app to "In production" removes the limit, but Google requires a home page and privacy policy URL for that.

### Files
| File | Contents |
| --- | --- |
| `~/.claude/open-todos-gtasks-client.json` | OAuth client (from step 4) |
| `~/.claude/open-todos-gtasks-auth.json` | Refresh token (written by the setup script, mode 600) |
| `~/.claude/open-todos-gtasks.json` | Sync state: task mapping, last error |

To turn sync off, delete `open-todos-gtasks-auth.json` and revoke access at https://myaccount.google.com/permissions.

## Updating
Run the install script again. The pane runs from the installed copy in `~/.claude/mods/open-todos`, so changes to this repo only take effect after reinstalling.

## Uninstall
- macOS / Linux: `bash uninstall.sh`. It revokes the Google sign-in, removes the mod and its `settings.json` entry (other mods are kept; a backup is made), and deletes all `~/.claude/open-todos-*` files. Task lists already created in Google Tasks stay in that Google account.
- Windows: delete `~/.claude/mods/open-todos` and remove its path from `env.CLAUDE_CODE_PLUGIN_DIRS` in `settings.json`.
