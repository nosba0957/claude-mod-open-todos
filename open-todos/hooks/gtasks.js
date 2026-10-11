// Google Tasks sync for scan.js output. Open todos are pushed as tasks, one task list per project, and Google-side
// edits are applied to the pane: completed or deleted there → hidden here, renamed → new title, added → extra items.
// Claude's own session task lists are never changed. Stays off until gtasks-setup.js has written AUTH.
// Self-check: node hooks/gtasks.js
const fs = require('fs'), path = require('path'), os = require('os')
const dir = path.join(os.homedir(), '.claude')
const AUTH = path.join(dir, 'open-todos-gtasks-auth.json')
const STATE = path.join(dir, 'open-todos-gtasks.json')
const LOCK = STATE + '.lock'
const API = 'https://tasks.googleapis.com/tasks/v1'
// ponytail: the Tasks API has no webhooks, so Google is polled at most every 2 min (shared by all open sessions)
const SYNC_MS = 120000
// new tasks pushed per sync, so a big first push cannot outlast scan.js's 60 s timeout
const MAX_NEW = 40

const projKey = p => (p.project === 'No folder' ? p.project : p.cwd)
const itemKey = (s, t) => s.id + '|' + t.subject

function load() {
  try { return { lists: {}, tasks: {}, extra: {}, at: 0, ...JSON.parse(fs.readFileSync(STATE, 'utf8')) } } catch {}
  return { lists: {}, tasks: {}, extra: {}, at: 0 }
}

// Pure: scan result + last known Google state → what the pane shows.
function apply(result, st) {
  const out = []
  const seen = new Set()
  for (const p of result) {
    const pk = projKey(p)
    seen.add(pk)
    const sessions = [], running = [...p.running]
    for (const s of p.sessions) {
      let hidden = 0
      const items = []
      for (const t of s.items) {
        const g = st.tasks[itemKey(s, t)]
        if (g && g.done) hidden++
        else items.push(g && g.title !== t.subject ? { ...t, subject: g.title } : t)
      }
      if (items.length) sessions.push({ ...s, items, done: s.done + hidden })
      else if (s.running) running.push({ id: s.id, title: s.title, last: s.last || '', tool: s.tool || '', mtime: s.mtime })
    }
    const extra = st.extra[pk] || []
    if (extra.length) sessions.push(googleSession(extra))
    if (sessions.length || running.length) out.push({ ...p, sessions: sessions.sort((a, b) => b.mtime - a.mtime), running })
  }
  // tasks added in Google to a project that has no open Claude todos left
  for (const [pk, extra] of Object.entries(st.extra)) {
    const l = st.lists[pk]
    if (!seen.has(pk) && l && extra.length) out.push({ project: l.title, cwd: l.cwd, sessions: [googleSession(extra)], running: [] })
  }
  return out
}

function googleSession(extra) {
  return {
    id: 'google', title: 'Google Tasks', mtime: Math.max(...extra.map(x => x.mtime)), done: 0, total: extra.length,
    items: extra.map(x => ({ subject: x.title, status: 'pending' })),
  }
}

function lock() {
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true } catch {}
  try { // a sync that crashed leaves its lock behind
    if (Date.now() - fs.statSync(LOCK).mtimeMs > 300000) { fs.unlinkSync(LOCK); fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true }
  } catch {}
  return false
}

async function token() {
  const a = JSON.parse(fs.readFileSync(AUTH, 'utf8'))
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ client_id: a.client_id, client_secret: a.client_secret, refresh_token: a.refresh_token, grant_type: 'refresh_token' }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error('token: ' + (j.error_description || j.error))
  return j.access_token
}

async function push(result, st) {
  const tok = await token()
  const api = async (method, url, body) => {
    const r = await fetch(API + url, {
      method, signal: AbortSignal.timeout(15000), body: body && JSON.stringify(body),
      headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
    })
    if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${(await r.text()).slice(0, 200)}`)
    return r.status === 204 ? null : r.json()
  }
  const all = async url => {
    const got = []
    let page = ''
    do {
      const j = await api('GET', url + (url.includes('?') ? '&' : '?') + 'maxResults=100' + (page ? '&pageToken=' + page : ''))
      got.push(...(j.items || []))
      page = j.nextPageToken
    } while (page)
    return got
  }

  // one list per project; a lost state file reuses lists by title instead of making duplicates
  const lists = await all('/users/@me/lists')
  for (const p of result) {
    const pk = projKey(p)
    if (st.lists[pk] && lists.some(l => l.id === st.lists[pk].id)) continue
    const found = lists.find(l => l.title === p.project)
    const l = found || (await api('POST', '/users/@me/lists', { title: p.project }))
    if (!found) lists.push(l)
    st.lists[pk] = { id: l.id, title: p.project, cwd: p.cwd }
  }

  // the user's own lists (not made for a project) show up in the pane as groups of their own
  for (const pk of Object.keys(st.lists)) if (pk.startsWith('google:')) delete st.lists[pk]
  const ours = new Set(Object.values(st.lists).map(l => l.id))
  for (const l of lists) if (!ours.has(l.id)) st.lists['google:' + l.id] = { id: l.id, title: l.title, cwd: 'google:' + l.id }

  const remote = new Map()
  for (const l of Object.values(st.lists)) {
    if (!lists.some(x => x.id === l.id)) continue // list deleted in Google: its tasks count as deleted
    for (const t of await all(`/lists/${l.id}/tasks?showCompleted=true&showHidden=true`)) remote.set(t.id, { ...t, list: l.id })
  }

  const live = new Set()
  let added = 0
  for (const p of result) {
    for (const s of p.sessions) {
      for (const t of s.items) {
        const k = itemKey(s, t)
        live.add(k)
        const g = st.tasks[k]
        if (g) {
          const r = remote.get(g.id)
          g.done = !r || r.status === 'completed'
          if (r) g.title = r.title
        } else if (added < MAX_NEW) {
          added++
          const list = st.lists[projKey(p)].id
          const r = await api('POST', `/lists/${list}/tasks`, { title: t.subject, notes: `${s.title || 'untitled'} (session ${s.id})` })
          st.tasks[k] = { list, id: r.id, title: t.subject, done: false }
        }
      }
    }
  }
  // finished (or gone) on the Claude side: tick it off in Google too
  for (const [k, g] of Object.entries(st.tasks)) {
    if (live.has(k)) continue
    const r = remote.get(g.id)
    if (r && r.status !== 'completed') await api('PATCH', `/lists/${g.list}/tasks/${g.id}`, { status: 'completed' })
    delete st.tasks[k]
  }

  const mine = new Set(Object.values(st.tasks).map(g => g.id))
  const pkOf = new Map(Object.entries(st.lists).map(([pk, l]) => [l.id, pk]))
  st.extra = {}
  for (const r of remote.values()) {
    if (mine.has(r.id) || r.status === 'completed' || !r.title) continue
    const pk = pkOf.get(r.list)
    if (pk) (st.extra[pk] = st.extra[pk] || []).push({ title: r.title, mtime: Date.parse(r.updated) })
  }
}

// Never throws: on any failure the pane still gets the scan result with the last known Google state.
async function sync(result) {
  const st = load()
  const on = fs.existsSync(AUTH)
  if (on && Date.now() - st.at >= SYNC_MS && lock()) {
    try {
      await push(result, st)
      st.error = ''
    } catch (x) {
      st.error = String(x)
    } finally {
      st.at = Date.now()
      try { fs.writeFileSync(STATE, JSON.stringify(st)) } catch {}
      try { fs.unlinkSync(LOCK) } catch {}
    }
  }
  // repeated on every scan, not only on sync attempts, so the pane keeps showing it until a sync succeeds
  if (on && st.error) process.stderr.write('google tasks: ' + st.error.replace(/\s+/g, ' ') + '\n')
  return apply(result, st)
}

module.exports = { sync, apply }

if (require.main === module) {
  const assert = require('assert')
  const s = (id, subjects, extra = {}) => ({ id, title: 't', mtime: 1, done: 0, total: subjects.length, items: subjects.map(subject => ({ subject, status: 'pending' })), ...extra })
  const result = [
    { project: 'a', cwd: '/a', running: [], sessions: [s('s1', ['x', 'y']), s('s2', ['z'], { running: true, last: 'hi', tool: 'Bash' })] },
  ]
  const st = {
    lists: { '/a': { id: 'L1', title: 'a', cwd: '/a' }, '/b': { id: 'L2', title: 'b', cwd: '/b' } },
    tasks: { 's1|x': { done: true, title: 'x' }, 's1|y': { done: false, title: 'y2' }, 's2|z': { done: true, title: 'z' } },
    extra: { '/a': [{ title: 'from google', mtime: 5 }], '/b': [{ title: 'only google', mtime: 2 }] },
  }
  const [a, b] = apply(result, st)
  assert.deepStrictEqual(a.sessions.map(x => x.id), ['google', 's1']) // newest first
  assert.deepStrictEqual(a.sessions[1].items.map(x => x.subject), ['y2']) // x hidden, y renamed
  assert.strictEqual(a.sessions[1].done, 1)
  assert.deepStrictEqual(a.running.map(x => x.id), ['s2']) // all hidden but still running
  assert.deepStrictEqual(b.sessions[0].items, [{ subject: 'only google', status: 'pending' }])
  assert.deepStrictEqual(apply(result, { lists: {}, tasks: {}, extra: {} })[0].sessions.length, 2) // no state: unchanged
  console.log('ok')
}
