// One-time Google sign-in for the Tasks sync: node gtasks-setup.js <client_secret.json>
// Works over SSH too: if the browser cannot reach this machine, paste the URL it ends up on.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), crypto = require('crypto'), readline = require('readline')
const AUTH = path.join(os.homedir(), '.claude', 'open-todos-gtasks-auth.json')

const file = process.argv[2]
if (!file) {
  console.log(`用法：node ${path.basename(__filename)} <client_secret.json>

取得 client_secret.json（只需做一次）：
1. 建立 Google Cloud 專案：https://console.cloud.google.com/projectcreate
2. 啟用 Tasks API：https://console.cloud.google.com/apis/library/tasks.googleapis.com
3. 設定 OAuth 同意畫面：https://console.cloud.google.com/auth/overview
   使用者類型選「外部」，並在「目標對象」把應用程式「發布」為正式版。
   （若停在「測試」狀態，授權每 7 天會失效，需要重跑本腳本。）
4. 建立用戶端：https://console.cloud.google.com/auth/clients
   應用程式類型選「電腦版應用程式」，建立後下載 JSON，放到這台機器上。`)
  process.exit(1)
}

const c = JSON.parse(fs.readFileSync(file, 'utf8')).installed
if (!c) throw new Error('這不是「電腦版應用程式」用戶端的 JSON')
const state = crypto.randomBytes(16).toString('hex')
let redirect = ''

async function finish(u) {
  if (u.searchParams.get('state') !== state) throw new Error('state 不符，請重新執行')
  if (u.searchParams.get('error')) throw new Error('授權被拒：' + u.searchParams.get('error'))
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ code: u.searchParams.get('code'), client_id: c.client_id, client_secret: c.client_secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  })
  const j = await r.json()
  if (!r.ok || !j.refresh_token) throw new Error('換取權杖失敗：' + JSON.stringify(j))
  fs.writeFileSync(AUTH, JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: j.refresh_token }), { mode: 0o600 })
  console.log(`\n完成。授權已存到 ${AUTH}\n待辦面板下次掃描時會開始同步（之後每 2 分鐘一次）。`)
  process.exit(0)
}
const fail = x => { console.error(String(x.message || x)); process.exit(1) }

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, redirect)
  if (!u.searchParams.has('state')) return res.end()
  res.end('Done. You can close this tab.')
  finish(u).catch(fail)
})
srv.listen(0, '127.0.0.1', () => {
  redirect = `http://127.0.0.1:${srv.address().port}`
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: c.client_id, redirect_uri: redirect, response_type: 'code', state,
    scope: 'https://www.googleapis.com/auth/tasks', access_type: 'offline', prompt: 'consent',
  })
  console.log(`在瀏覽器開啟這個網址並登入：\n\n${url}\n`)
  console.log('如果瀏覽器最後顯示「無法連上網站」（例如透過 SSH 連線時），請把網址列的完整網址貼到這裡：')
  readline.createInterface({ input: process.stdin }).on('line', l => {
    if (l.trim()) finish(new URL(l.trim())).catch(fail)
  })
})
