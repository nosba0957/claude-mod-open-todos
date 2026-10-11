// Replays TaskCreate/TaskUpdate/TodoWrite of every session jsonl; prints unfinished items per project.
// Per-file results are cached by size + mtime, so a rescan only re-reads sessions that changed.
const fs = require('fs'), path = require('path'), os = require('os')
const root = path.join(os.homedir(), '.claude', 'projects')
const cacheFile = path.join(os.homedir(), '.claude', 'open-todos-cache.json')
const VERSION = 2
const BAD = new RegExp('[\\ufffd\\ud800-\\udfff]') // titles that were saved as mojibake

// ~/.claude/open-todos-ignore.txt: one entry per line (project name, project folder, or 8-character session id);
// matching projects/sessions are left out of the list. Lines starting with # are comments.
const norm = x => x.trim().replace(/\\/g, '/').toLowerCase()
let ignore = []
try {
  ignore = fs.readFileSync(path.join(os.homedir(), '.claude', 'open-todos-ignore.txt'), 'utf8')
    .split('\n').map(norm).filter(l => l && !l.startsWith('#'))
} catch {}
// claude-mem runs background "observer" sessions from a folder of this name; they are not the user's work
ignore.push('observer-sessions')
const ignored = (...keys) => keys.some(k => k && ignore.includes(norm(k)))

let cache = {}
try {
  const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  if (c.version === VERSION) cache = c.files
} catch {}
const next = {}

function parse(fp, id) {
  const txt = fs.readFileSync(fp, 'utf8')
  const m = txt.match(/"cwd":"((?:[^"\\]|\\.)*)"/)
  const cwd = m ? JSON.parse('"' + m[1] + '"') : ''
  if (!/"name":"(TaskCreate|TodoWrite)"/.test(txt)) return { cwd, sess: null }
  let items = [], nextId = 1, title = ''
  for (const line of txt.split('\n')) {
    if (line.startsWith('{"type":"custom-title"')) {
      try { const t = JSON.parse(line).customTitle; if (t && !BAD.test(t)) title = t } catch {}
      continue
    }
    if (!line.includes('"tool_use"')) continue
    let d; try { d = JSON.parse(line) } catch { continue }
    const c = d.message && d.message.content
    if (!Array.isArray(c)) continue
    for (const b of c) {
      if (b.type !== 'tool_use') continue
      const i = b.input || {}
      if (b.name === 'TodoWrite') items = (i.todos || []).map((t, n) => ({ id: String(n), subject: t.content, status: t.status }))
      else if (b.name === 'TaskCreate') items.push({ id: String(nextId++), subject: i.subject, status: 'pending' })
      else if (b.name === 'TaskUpdate') {
        const t = items.find(x => x.id === String(i.taskId))
        if (t) { if (i.status) t.status = i.status; if (i.subject) t.subject = i.subject }
      }
    }
  }
  const open = items.filter(t => t.status === 'pending' || t.status === 'in_progress').map(t => ({ subject: t.subject, status: t.status }))
  if (!open.length) return { cwd, sess: null }
  return { cwd, sess: { id, title, done: items.filter(t => t.status === 'completed').length, total: items.length, items: open } }
}

// A session counts as running when its record was written in the last RUN_MIN minutes.
// Its title, last prompt and current tool come from the tail of the file only.
function tailInfo(fp, size) {
  const n = Math.min(size, 262144)
  const buf = Buffer.alloc(n)
  const fd = fs.openSync(fp, 'r')
  try { fs.readSync(fd, buf, 0, n, size - n) } finally { fs.closeSync(fd) }
  const lines = buf.toString('utf8').split('\n')
  if (size > n) lines.shift() // first line is cut off
  let title = '', last = '', tool = ''
  for (let i = lines.length - 1; i >= 0 && !last; i--) {
    const line = lines[i]
    if (!line) continue
    let d; try { d = JSON.parse(line) } catch { continue }
    if (d.type === 'custom-title' && !title && d.customTitle && !BAD.test(d.customTitle)) { title = d.customTitle; continue }
    const c = d.message && d.message.content
    if (d.type === 'assistant' && Array.isArray(c) && !tool) {
      const t = [...c].reverse().find(b => b.type === 'tool_use')
      if (t) tool = t.name
    }
    if (d.type === 'user' && c && !d.isMeta) {
      const text = typeof c === 'string' ? c : (Array.isArray(c) ? ((c.find(b => b.type === 'text') || {}).text || '') : '')
      const clean = text.trim()
      if (clean && !/^(<|\[|Base directory for this skill)/.test(clean)) last = clean.replace(/\s+/g, ' ').slice(0, 80)
    }
  }
  if (!title) for (const line of lines) { // title may sit above the last prompt
    if (line.startsWith('{"type":"custom-title"')) { try { const t = JSON.parse(line).customTitle; if (t && !BAD.test(t)) title = t } catch {} }
  }
  return { title, last, tool }
}

const RUN_MIN = 5
const out = []
for (const dir of fs.readdirSync(root)) {
  const dp = path.join(root, dir)
  let files
  try { files = fs.readdirSync(dp).filter(f => f.endsWith('.jsonl')) } catch { continue }
  let cwd = ''
  const sessions = []
  const running = []
  for (const f of files) {
    const fp = path.join(dp, f)
    let st
    try { st = fs.statSync(fp) } catch { continue }
    let hit = cache[fp]
    if (!hit || hit.size !== st.size || hit.mtimeMs !== st.mtimeMs) {
      try { hit = { size: st.size, mtimeMs: st.mtimeMs, ...parse(fp, f.slice(0, 8)) } } catch { continue }
    }
    next[fp] = hit
    if (!cwd && hit.cwd) cwd = hit.cwd
    const id = f.slice(0, 8)
    if (ignored(id)) continue
    const live = Date.now() - st.mtimeMs <= RUN_MIN * 60000
    let info = null
    if (live) { try { info = tailInfo(fp, st.size) } catch {} }
    if (hit.sess) sessions.push({ ...hit.sess, mtime: st.mtimeMs, ...(live && info ? { running: true, last: info.last, tool: info.tool, title: hit.sess.title || info.title } : {}) })
    else if (live && info) running.push({ id, title: info.title, last: info.last, tool: info.tool, mtime: st.mtimeMs })
  }
  // a project whose folder was deleted keeps its session records under ~/.claude/projects: skip it
  if ((sessions.length || running.length) && (!cwd || fs.existsSync(cwd)) && !ignored(path.basename(cwd || dir), cwd)) {
    out.push({
      project: path.basename(cwd || dir) || dir, cwd,
      sessions: sessions.sort((a, b) => b.mtime - a.mtime),
      running: running.sort((a, b) => b.mtime - a.mtime),
    })
  }
}
// sessions started without a project folder live in throwaway scratch dirs: show them as one group
const merged = new Map()
for (const p of out) {
  const key = /scratch-workspaces/.test(p.cwd) ? 'No folder' : p.project + '|' + p.cwd
  const m = merged.get(key)
  if (!m) merged.set(key, { ...p, project: key === 'No folder' ? key : p.project })
  else { m.sessions.push(...p.sessions); m.running.push(...p.running) }
}
const result = [...merged.values()]
for (const p of result) { p.sessions.sort((a, b) => b.mtime - a.mtime); p.running.sort((a, b) => b.mtime - a.mtime) }
const latest = p => Math.max(...p.sessions.map(s => s.mtime), ...p.running.map(s => s.mtime))
result.sort((a, b) => latest(b) - latest(a))
try { fs.writeFileSync(cacheFile, JSON.stringify({ version: VERSION, files: next })) } catch {}
require('./gtasks').sync(result).then(r => console.log(JSON.stringify(r)))
