import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TodoProject, TodoSession } from '../types'

// Design: "Spine". No cards, no backgrounds. Each project is a vertical line whose stroke
// thins and turns rose as its sessions age. Status is carried by glyph shape first, colour second.
const PANE = 'open-todos'
const state = atom({ plugin: 'open-todos', key: 'projects' } as const, [] as TodoProject[])
const err = atom({ plugin: 'open-todos', key: 'error' } as const, '')
// last Google Tasks sync failure, reported by scan.js on stderr; '' when fine or sync is off
const gerr = atom({ plugin: 'open-todos', key: 'gerror' } as const, '')
// Mouse folding, keyed by project cwd: collapsed = body hidden, expanded = every session and item shown.
const collapsed = atom({ plugin: 'open-todos', key: 'collapsed' } as const, [] as string[])
const expanded = atom({ plugin: 'open-todos', key: 'expanded' } as const, [] as string[])
const without = (list: string[], x: string) => list.filter(y => y !== x)

// Soft palette, tuned for dark themes (Tailwind "300" level, a touch desaturated). Cool hues identify projects;
// the warm/green/rose accents are reserved for status. Light themes get lower contrast: swap these values there.
const HUES = ['#7FD6CB', '#9DB0FF', '#BFA9FF', '#8EDDB0', '#85CBF0', '#DDAEEB']
const WIP = '#F3CB82' // in progress
const FAINT = '#8E96AD' // waiting
const RUN = '#86DDAE' // running now
const ROSE = '#EB96A8' // untouched for a long time
const TRACK = '#4A5168' // empty part of a progress bar
const STALE_DAYS = 14

function hueOf(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return HUES[h % HUES.length]
}

function daysSince(ms: number): number {
  return Math.floor((Date.now() - ms) / 86400000)
}

function ago(d: number): string {
  if (d < 1) return '今天'
  if (d === 1) return '昨天'
  if (d >= 60) return `${Math.floor(d / 30)} 個月前`
  return `${d} 天前`
}

// done / in-progress / waiting as 10 cells (largest remainder); fewer than 10 tasks get one cell each.
function bars(done: number, wip: number, wait: number): [number, number, number] {
  const total = done + wip + wait
  if (total <= 10) return [done, wip, wait]
  const raw = [done, wip, wait].map(n => (n * 10) / total)
  const out = raw.map(Math.floor)
  let left = 10 - out.reduce((a, b) => a + b, 0)
  const order = [0, 1, 2].sort((a, b) => raw[b] - out[b] - (raw[a] - out[a]))
  for (const i of order) if (left > 0) { out[i]++; left-- }
  for (let i = 0; i < 3; i++) {
    if ([done, wip, wait][i] > 0 && out[i] === 0) {
      out[out.indexOf(Math.max(...out))]--
      out[i] = 1
    }
  }
  return [out[0], out[1], out[2]]
}

function has(x: string | undefined): boolean {
  return x !== undefined && x !== ''
}

// a running session that shows more than its title line
function rich(r: { title: string; last: string; tool: string }): boolean {
  return (r.title !== '' && r.last !== '') || r.tool !== ''
}

function wipCount(s: TodoSession): number {
  return s.items.filter(t => t.status === 'in_progress').length
}

// Desktop progress bar: one slim capsule per state, all on the same centre line, so nothing can step out of
// alignment the way block glyphs of different heights do. The SVG is as tall as a text line, which leaves
// even space above and below the 6px bar.
function barSvg(done: number, wip: number, wait: number, hue: string, faded: boolean): string {
  const W = 96, H = 18, h = 6, y = (H - h) / 2, gap = 2
  const parts = ([[done, hue], [wip, WIP], [wait, TRACK]] as [number, string][]).filter(([n]) => n > 0)
  const total = parts.reduce((a, [n]) => a + n, 0)
  const room = W - gap * (parts.length - 1)
  const raw = parts.map(([n]) => Math.max(h, (n / total) * room))
  const sum = raw.reduce((a, b) => a + b, 0)
  let x = 0
  let rects = ''
  parts.forEach(([, c], i) => {
    const w = (raw[i] * room) / sum
    rects += `<rect x="${x.toFixed(2)}" y="${y}" width="${w.toFixed(2)}" height="${h}" rx="${h / 2}" fill="${c}"/>`
    x += w + gap
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g opacity="${faded ? 0.5 : 1}">${rects}</g></svg>`
}

// Desktop project heading: Text has no font size, so the heading is drawn as SVG text, 2px larger than the
// pane's ~12px body; its box is 6px taller than the ~19px line, and all the extra room sits under the text.
// Long names are cut with an ellipsis from an estimated width (full-width characters 1em, others 0.62em).
const TITLE_FS = 14
const TITLE_H = 25
const TITLE_MAX = 280

function titleSvg(text: string, color: string): { svg: string; width: number } {
  const adv = (ch: string) => (ch.charCodeAt(0) > 0x2e7f ? TITLE_FS : TITLE_FS * 0.62)
  let out = ''
  let width = 0
  for (const ch of text) {
    if (width + adv(ch) > TITLE_MAX) {
      out += '…'
      width += TITLE_FS
      break
    }
    out += ch
    width += adv(ch)
  }
  const safe = out.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const w = Math.ceil(width) + 4
  return {
    width: w,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${TITLE_H}" viewBox="0 0 ${w} ${TITLE_H}"><text x="0" y="14.5" font-family="Segoe UI, Microsoft JhengHei, PingFang TC, -apple-system, BlinkMacSystemFont, sans-serif" font-size="${TITLE_FS}" font-weight="700" fill="${color}">${safe}</text></svg>`,
  }
}

function dotSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="18" viewBox="0 0 16 18"><circle cx="5" cy="9" r="3.5" fill="${color}"/></svg>`
}

// Overlapping requests collapse into one follow-up scan; an unchanged result is not redrawn.
let busy = false
let dirty = false
let last = ''

async function refresh($: any) {
  if (busy) {
    dirty = true
    return
  }
  busy = true
  try {
    const r = await $.process.run(['node', `${$.plugin.root}/hooks/scan.js`], { timeoutMs: 60000 })
    if (r.exitCode !== 0) throw new Error(r.stderr.slice(0, 200))
    if (r.stdout !== last) {
      last = r.stdout
      await update($, state, () => JSON.parse(r.stdout))
    }
    await update($, err, () => '')
    await update($, gerr, () => r.stderr.match(/^google tasks: (.*)$/m)?.[1] ?? '')
  } catch (x) {
    await update($, err, () => String(x))
  } finally {
    busy = false
    if (dirty) {
      dirty = false
      void refresh($)
    }
  }
}

const TODO_TOOLS = ['TaskCreate', 'TaskUpdate', 'TodoWrite']

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'todos', description: 'Open pane of unfinished todos across all sessions' })
    void $.ui.open({ id: PANE, title: 'Todos' })
    void refresh($)
    // other sessions change todos too: look again every 20 s (scans only re-read changed session files)
    $.clock.every(20_000, () => void refresh($))
    return next(e)
  })

  // Claude created or changed a todo: refresh once the tool has run and the transcript has the entry
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (TODO_TOOLS.includes(e.tool)) void refresh($)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'todos' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Todos' })
    await refresh($)
    return { text: 'Todos pane refreshed.' }
  })

  // ponytail: rescans on every prompt; add a timer/cache if the session history gets big
  on('prompt.submit', async ($, e, next) => {
    void refresh($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const raw = await read($, state)
    const error = await read($, err)
    const gerror = await read($, gerr)
    const shut = await read($, collapsed)
    const wide = await read($, expanded)
    const fold = (cwd: string) => {
      void update($, collapsed, l => [...without(l, cwd), cwd])
      void update($, expanded, l => without(l, cwd))
    }
    const unfold = (cwd: string, all: boolean) => {
      void update($, collapsed, l => without(l, cwd))
      void update($, expanded, l => (all ? [...without(l, cwd), cwd] : without(l, cwd)))
    }

    const refreshBtn = <Button key="refresh" label="↻ 重新整理" plain dimColor onPress={() => void refresh($)} />

    if (error !== '') {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text bold>無法讀取待辦資料</Text>
          <Text dimColor wrap="truncate-end">{error}</Text>
          <Text dimColor>請確認 ~/.claude 目錄存在且可讀取，再重新開啟面板。</Text>
          {refreshBtn}
        </Box>
      )
    }
    if (raw.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text bold>沒有未完成的待辦，也沒有執行中的 session</Text>
          <Text dimColor>所有 session 的待辦都已完成，或已被排除清單略過。之後 Claude 新增待辦或開始執行時，會顯示在這裡。</Text>
          {refreshBtn}
        </Box>
      )
    }

    // Projects with work in progress first, then by latest activity (scan.js already sorts by activity).
    const live = (p: TodoProject) => p.running.length + p.sessions.filter(s => s.running).length
    const projects = [...raw].sort(
      (a, b) =>
        Number(live(b) > 0) - Number(live(a) > 0) ||
        Number(b.sessions.some(s => wipCount(s) > 0)) - Number(a.sessions.some(s => wipCount(s) > 0)),
    )
    const many = projects.length > 4
    const sessionsAll = projects.flatMap(p => p.sessions)
    const wipTotal = sessionsAll.reduce((n, s) => n + wipCount(s), 0)
    const waitTotal = sessionsAll.reduce((n, s) => n + s.items.length, 0) - wipTotal
    const staleTotal = sessionsAll.filter(s => daysSince(s.mtime) > STALE_DAYS).length
    const liveTotal = projects.reduce((n, p) => n + live(p), 0)

    // Layout rules (so long text can never squeeze a sibling to zero width):
    //  - fixed things (spine, gap, right-hand label) are flexShrink 0
    //  - text lives in a box that starts at width 1 and grows, so its natural width never counts
    const fill = (child: any) => (
      <Box width={1} flexGrow={1} flexShrink={1}>
        {child}
      </Box>
    )
    const stat = (glyph: string, color: string, n: number, label: string) => (
      <Box gap={1} flexShrink={0}>
        <Text color={n > 0 ? color : undefined} bold={n > 0} dimColor={n === 0}>{glyph}</Text>
        <Text bold={n > 0} dimColor={n === 0}>{n}</Text>
        <Text dimColor={n === 0}>{label}</Text>
      </Box>
    )
    const titleRow = (text: string, dim: boolean, right: any) => (
      <Box>
        {fill(<Text dimColor={dim} wrap="truncate-end">{text}</Text>)}
        <Box flexShrink={0} marginLeft={1}>{right}</Box>
      </Box>
    )
    const runLabel = <Text color={RUN} bold>▶ 執行中</Text>
    const recentLine = (last: string) => <Text dimColor wrap="truncate-end">最近：{last}</Text>
    const toolLine = (tool: string) => (
      <Box>
        <Text dimColor>正在使用 </Text>
        {fill(<Text wrap="truncate-end">{tool}</Text>)}
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box gap={2}>
          {stat('▶', RUN, liveTotal, '執行中')}
          {stat('◐', WIP, wipTotal, '進行')}
          {stat('○', FAINT, waitTotal, '待辦')}
          <Box flexGrow={1} />
          {refreshBtn}
        </Box>
        {gerror !== '' && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={ROSE} wrap="truncate-end">Google 同步失敗：{gerror}</Text>
            {/invalid_grant|token/.test(gerror) && (
              <Text dimColor wrap="truncate-end">授權可能已過期（測試模式每 7 天一次），請重跑 hooks/gtasks-setup.js</Text>
            )}
          </Box>
        )}
        {staleTotal > 0 && (
          <Box marginTop={1}>
            {Svg !== undefined ? (
              <Svg source={dotSvg(ROSE)} alt="提醒" width={16} height={18} />
            ) : (
              <Text color={ROSE}>• </Text>
            )}
            {fill(<Text color={ROSE} wrap="truncate-end">{staleTotal} 個 session 超過 {STALE_DAYS} 天沒動</Text>)}
          </Box>
        )}

        {projects.map(p => {
          const hue = hueOf(p.project)
          const count = p.sessions.reduce((n, s) => n + s.items.length, 0)
          const newest = daysSince(p.sessions.length > 0 ? p.sessions[0].mtime : p.running[0].mtime)
          const hasWip = p.sessions.some(s => wipCount(s) > 0)

          const autoFold = many && !hasWip && live(p) === 0 && newest > STALE_DAYS
          const all = wide.includes(p.cwd)
          if (shut.includes(p.cwd) || (autoFold && !all)) {
            const stale = newest > STALE_DAYS
            return (
              <Box marginTop={1}>
                <Box width={1} flexShrink={0} backgroundColor={stale ? ROSE : hue} marginRight={1} />
                {fill(
                  <Button key={`open:${p.cwd}`} plain onPress={() => unfold(p.cwd, autoFold)}>
                    ▸ {p.project}
                  </Button>,
                )}
                <Box flexShrink={0} marginLeft={1} gap={2}>
                  <Text dimColor>{count} 項</Text>
                  <Text color={stale ? ROSE : undefined} dimColor={!stale}>{ago(newest)}</Text>
                </Box>
              </Box>
            )
          }

          const cap = all ? Infinity : many ? 2 : 3
          const shown = p.sessions.slice(0, cap)
          const hidden = p.sessions.length - shown.length
          const heading = titleSvg(p.project, hue)

          // The project name is a heading: it sits outdented above its spine, in the project colour,
          // so it reads as the label of the block rather than one more row inside it.
          return (
            <Box flexDirection="column" marginTop={1}>
              <Box alignItems="flex-start">
                {fill(
                  Svg !== undefined ? (
                    <Svg source={heading.svg} alt={p.project} width={heading.width} height={TITLE_H} />
                  ) : (
                    <Text bold color={hue} wrap="truncate-end">{p.project}</Text>
                  ),
                )}
                <Box flexShrink={0} marginLeft={1}>
                  <Button key={`fold:${p.cwd}`} plain dimColor onPress={() => fold(p.cwd)}>
                    {count > 0 ? `${count} 項 ▾` : '▾'}
                  </Button>
                </Box>
              </Box>
              <Box>
              <Box width={1} flexShrink={0} backgroundColor={hue} />
              <Box width={1} flexShrink={0} />
              <Box width={1} flexGrow={1} flexShrink={1} flexDirection="column">
                {shown.map((s, i) => {
                  const d = daysSince(s.mtime)
                  const old = d > STALE_DAYS
                  const wip = wipCount(s)
                  const [bd, bw, bt] = bars(s.done, wip, Math.max(0, s.total - s.done - wip))
                  const itemCap = old ? 2 : many ? 3 : 5
                  const sorted = [...s.items].sort(
                    (a, b) => Number(b.status === 'in_progress') - Number(a.status === 'in_progress'),
                  )
                  const rows = all ? sorted : sorted.slice(0, Math.min(6, Math.max(itemCap, wip)))
                  const folded = sorted.length - rows.length
                  const named = s.title !== ''

                  return (
                    <Box flexDirection="column" marginTop={i > 0 ? 1 : 0}>
                      {titleRow(
                        named ? s.title : `未命名 #${s.id.slice(0, 4)}`,
                        !named || (old && !s.running),
                        s.running ? runLabel : <Text color={old ? ROSE : undefined} dimColor={!old}>{ago(d)}</Text>,
                      )}
                      {s.running && has(s.last) && named && recentLine(s.last as string)}
                      {s.running && has(s.tool) && toolLine(s.tool as string)}
                      {s.total > 1 && (
                        <Box gap={1}>
                          {Svg !== undefined ? (
                            <Svg
                              source={barSvg(s.done, wip, Math.max(0, s.total - s.done - wip), hue, old)}
                              alt={`完成 ${s.done}/${s.total}`}
                              width={96}
                              height={18}
                            />
                          ) : (
                            <Box>
                              <Text color={hue}>{'━'.repeat(bd)}</Text>
                              <Text color={WIP}>{'━'.repeat(bw)}</Text>
                              <Text color={TRACK}>{'─'.repeat(bt)}</Text>
                            </Box>
                          )}
                          <Text dimColor>{s.done}/{s.total}</Text>
                        </Box>
                      )}
                      {rows.map(t => (
                        <Box>
                          <Text>  </Text>
                          <Text color={t.status === 'in_progress' ? WIP : FAINT} bold>
                            {t.status === 'in_progress' ? '◐ ' : '○ '}
                          </Text>
                          {fill(<Text bold={t.status === 'in_progress'} wrap="truncate-end">{t.subject}</Text>)}
                        </Box>
                      ))}
                      {folded > 0 && (
                        <Box>
                          <Text>    </Text>
                          <Button key={`more:${p.cwd}:${s.id}`} plain dimColor onPress={() => unfold(p.cwd, true)}>
                            還有 {folded} 項待辦 ▸
                          </Button>
                        </Box>
                      )}
                    </Box>
                  )
                })}
                {hidden > 0 && (
                  <Box marginTop={1}>
                    <Button key={`more:${p.cwd}`} plain dimColor onPress={() => unfold(p.cwd, true)}>
                      另有 {hidden} 個 session ▸
                    </Button>
                  </Box>
                )}
                {all && (
                  <Box marginTop={1}>
                    <Button key={`less:${p.cwd}`} plain dimColor onPress={() => unfold(p.cwd, false)}>
                      顯示較少 ▴
                    </Button>
                  </Box>
                )}

                {p.running.slice(0, 3).map((r, i, list) => {
                  const named = r.title !== ''
                  const text = named ? r.title : r.last !== '' ? r.last : `未命名 #${r.id.slice(0, 4)}`
                  // one-line entries stack as a tight list; a blank line only separates multi-line blocks
                  const gap = p.sessions.length > 0 ? i === 0 || rich(r) || rich(list[i - 1]) : i > 0 && (rich(r) || rich(list[i - 1]))
                  return (
                    <Box flexDirection="column" marginTop={gap ? 1 : 0}>
                      {titleRow(text, !named && r.last === '', runLabel)}
                      {named && r.last !== '' && recentLine(r.last)}
                      {r.tool !== '' && toolLine(r.tool)}
                    </Box>
                  )
                })}
                {p.running.length > 3 && (
                  <Box marginTop={rich(p.running[2]) ? 1 : 0}>
                    <Text dimColor>另有 {p.running.length - 3} 個執行中</Text>
                  </Box>
                )}
              </Box>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
