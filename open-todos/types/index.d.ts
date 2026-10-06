export type TodoItem = { subject: string; status: 'pending' | 'in_progress' }
export type TodoSession = { id: string; title: string; mtime: number; done: number; total: number; items: TodoItem[]; running?: boolean; last?: string; tool?: string }
export type RunningSession = { id: string; title: string; last: string; tool: string; mtime: number }
export type TodoProject = { project: string; cwd: string; sessions: TodoSession[]; running: RunningSession[] }

declare module 'claude-code' {
  interface PluginState {
    'open-todos': { projects: TodoProject[]; error: string; at: number }
  }
}
