import { expect, test } from 'claude-code/testing'

import type { TodoProject } from '../types'

const list: TodoProject[] = [{
  project: 'demo', cwd: '/demo', running: [],
  sessions: [{ id: 'abcd1234', title: 's', mtime: Date.now(), done: 0, total: 1, items: [{ subject: 'task one', status: 'pending' }] }],
}]

for (const surface of ['terminal', 'desktop'] as const) {
  test(`fold and unfold a project by click (${surface})`, async ($, on) => {
    // stands in for `node scan.js`
    on('process.run', async () => ({ value: { exitCode: 0, stdout: JSON.stringify(list), stderr: '' } }) as any)
    const ui = await $.ui.mount({ plugin: 'open-todos', surface, component: 'Pane', requestId: 'open-todos', props: {}, viewport: { columns: 60, rows: 40 } })
    await ui.press({ key: 'refresh' })
    expect(await ui.find({ text: 'task one' })).toBeDefined()
    await ui.press({ key: 'fold:/demo' })
    expect(await ui.find({ text: 'task one' })).toBeUndefined()
    await ui.press({ key: 'open:/demo' })
    expect(await ui.find({ text: 'task one' })).toBeDefined()
  })
}

test('shows a Google sync failure reported by scan.js', async ($, on) => {
  on('process.run', async () => ({ value: { exitCode: 0, stdout: JSON.stringify(list), stderr: 'google tasks: Error: token: Token has been expired or revoked.\n' } }) as any)
  const ui = await $.ui.mount({ plugin: 'open-todos', surface: 'terminal', component: 'Pane', requestId: 'open-todos', props: {}, viewport: { columns: 120, rows: 40 } })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ text: 'Google 同步失敗' })).toBeDefined()
  expect(await ui.find({ text: 'task one' })).toBeDefined()
})
