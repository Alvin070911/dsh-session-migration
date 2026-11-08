/**
 * Read-only inspection of the on-disk session store and the workspace registry.
 *
 * The UI list, the migration plan and the health check all read from here. Every
 * function is side-effect free: nothing in this module writes to a session log
 * or to `workspace.json`.
 *
 * @module dsh-session-migration/scan
 */

import fs from 'node:fs'
import path from 'node:path'
import { countFramesFile, readHeaderFile } from './frames.js'
import { encodeSegment, projectKey, currentLogFilename } from './paths.js'

const LOG_FILE_PATTERN = /^session\.v(\d+)\.jsonl\.zstd$/

/**
 * List the project-key directories under a sessions root.
 * @param {string} root sessions root.
 * @returns {string[]} absolute project directory paths.
 */
export function listProjectDirs(root) {
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name))
}

/**
 * Find a session directory's current log: the newest canonical generation file.
 * Non-canonical leftovers (`session.v4.jsonl.zstd.bak`, `…pre-restore-*`) are
 * ignored, exactly as DSH's own generation parser ignores them.
 * @param {string} dir absolute session directory.
 * @returns {{path: string, filename: string, version: number}|null} the log, when present.
 */
export function findLogFile(dir) {
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  const preferred = currentLogFilename()
  if (names.includes(preferred)) return { path: path.join(dir, preferred), filename: preferred, version: Number(preferred.match(LOG_FILE_PATTERN)[1]) }
  let best = null
  for (const name of names) {
    const match = LOG_FILE_PATTERN.exec(name)
    if (match === null) continue
    const version = Number(match[1])
    if (best === null || version > best.version) best = { path: path.join(dir, name), filename: name, version }
  }
  return best
}

/**
 * Scan every stored session.
 * @param {string} root sessions root.
 * @param {{ withFrames?: boolean, frameCache?: Map<string, {key: string, count: number}>, withHeader?: boolean }} [options] scan options.
 * @returns {Promise<Array<object>>} one record per session directory.
 */
export async function scanSessions(root, options = {}) {
  const withFrames = options.withFrames !== false
  const withHeader = options.withHeader !== false
  const cache = options.frameCache
  const records = []
  for (const projectDir of listProjectDirs(root)) {
    const key = path.basename(projectDir)
    let entries = []
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = path.join(projectDir, entry.name)
      const log = findLogFile(dir)
      const record = {
        id: entry.name,
        dir,
        projectKey: key,
        projectDir,
        logPath: log?.path ?? null,
        logFilename: log?.filename ?? null,
        formatVersion: log?.version ?? null,
        sizeBytes: 0,
        mtime: null,
        header: null,
        headerError: null,
        cwd: null,
        frames: null,
      }
      if (log !== null) {
        try {
          const stat = fs.statSync(log.path)
          record.sizeBytes = stat.size
          record.mtime = stat.mtimeMs
        } catch {
          /* keep zeros */
        }
        if (withHeader) {
          const head = readHeaderFile(log.path, fs)
          record.header = head.header
          record.headerError = head.headerError
          if (head.header !== null) {
            record.cwd = typeof head.header.cwd === 'string' ? head.header.cwd : null
          } else {
            record.sizeBytes = head.sizeBytes || record.sizeBytes
          }
        }
        if (withFrames) {
          record.frames = await frameCount(log.path, record.sizeBytes, cache)
        }
      } else {
        record.headerError = 'session directory holds no session log'
      }
      if (record.header !== null && typeof record.header.id === 'string') record.id = record.header.id
      records.push(record)
    }
  }
  records.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
  return records
}

/**
 * Count frames with a per-log cache keyed on size and mtime.
 * @param {string} logPath absolute log path.
 * @param {number} sizeBytes current size.
 * @param {Map<string, {key: string, count: number}>|undefined} cache optional cache.
 * @returns {Promise<number|null>} frame count, or null when it is too expensive.
 */
async function frameCount(logPath, sizeBytes, cache) {
  if (sizeBytes > 64 * 1024 * 1024) return null
  let key = `${sizeBytes}`
  try {
    key = `${sizeBytes}:${fs.statSync(logPath).mtimeMs}`
  } catch {
    /* keep size-only key */
  }
  const hit = cache?.get(logPath)
  if (hit !== undefined && hit.key === key) return hit.count
  const count = countFramesFile(logPath, fs)
  cache?.set(logPath, { key, count })
  await new Promise((resolve) => setImmediate(resolve))
  return count
}

/**
 * Read the raw workspace registry document. Read-only on purpose: the live
 * registry Service is authoritative while DSH runs, but the raw document is the
 * only place where a dangling reference is still visible.
 * @param {string} storagesRoot absolute storages root.
 * @returns {{path: string, data: object|null, error: string|null}} raw document.
 */
export function readRegistryRaw(storagesRoot) {
  const file = path.join(storagesRoot, 'workspace.json')
  try {
    const text = fs.readFileSync(file, 'utf8')
    return { path: file, data: JSON.parse(text), error: null }
  } catch (error) {
    return { path: file, data: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Flatten the raw registry into per-workspace records.
 * @param {object|null} raw workspace registry document.
 * @returns {Array<{id: string, path: string, title: string, sessionIds: string[], createdAt: string|null, updatedAt: string|null, dirExists: boolean}>} records.
 */
export function registryRecords(raw) {
  const out = []
  if (raw === null || typeof raw !== 'object') return out
  const global = raw.global ?? {}
  const tables = raw.tables?.workspaces ?? {}
  const order = Array.isArray(global.workspaceIds) ? global.workspaceIds : Object.keys(tables)
  for (const id of order) {
    const table = tables[id]
    if (table === undefined) {
      out.push({ id, path: '', title: '', sessionIds: [], createdAt: null, updatedAt: null, dirExists: false, missingRecord: true })
      continue
    }
    let dirExists = true
    try {
      dirExists = fs.statSync(table.path).isDirectory()
    } catch {
      dirExists = false
    }
    out.push({
      id,
      path: typeof table.path === 'string' ? table.path : '',
      title: typeof table.title === 'string' ? table.title : '',
      sessionIds: Array.isArray(table.sessionIds) ? table.sessionIds.filter((value) => typeof value === 'string') : [],
      createdAt: typeof table.createdAt === 'string' ? table.createdAt : null,
      updatedAt: typeof table.updatedAt === 'string' ? table.updatedAt : null,
      dirExists,
      missingRecord: false,
    })
  }
  return out
}

/**
 * Build the health-check issue list.
 * @param {object} input scan inputs.
 * @param {Array<object>} input.sessions scanned session records.
 * @param {Array<object>} input.workspaces flattened registry records.
 * @param {Array<object>} [input.pending] pending migration entries.
 * @returns {Array<{code: string, severity: 'error'|'warn'|'info', message: string, sessionId?: string, workspaceId?: string, path?: string, fixable?: boolean}>} issues.
 */
export function collectIssues({ sessions, workspaces, pending = [] }) {
  const issues = []
  const push = (issue) => issues.push(issue)

  const byId = new Map()
  for (const session of sessions) {
    // A directory without a log is an anomaly, not a second copy of a session.
    if (session.logPath === null) continue
    const list = byId.get(session.id)
    if (list === undefined) byId.set(session.id, [session])
    else list.push(session)
  }

  for (const session of sessions) {
    if (session.logPath === null) {
      push({ code: 'missing-log', severity: 'error', message: `会话目录里没有 session.v*.jsonl.zstd：${session.dir}`, sessionId: session.id, path: session.dir })
      continue
    }
    if (session.headerError !== null) {
      push({ code: 'unreadable-log', severity: 'error', message: `无法读取 header：${session.headerError}`, sessionId: session.id, path: session.logPath })
      continue
    }
    if (session.sizeBytes === 0) {
      push({ code: 'empty-log', severity: 'error', message: '日志为 0 字节', sessionId: session.id, path: session.logPath })
      continue
    }
    const header = session.header ?? {}
    const encoded = encodeSegment(String(header.id ?? ''))
    if (header.id !== undefined && encoded !== path.basename(session.dir)) {
      push({ code: 'id-mismatch', severity: 'error', message: `目录名与会话 id 不一致（header.id=${header.id}）`, sessionId: session.id, path: session.dir })
    }
    if (typeof header.cwd !== 'string' || header.cwd.length === 0) {
      push({ code: 'missing-cwd', severity: 'error', message: 'header 里没有 cwd', sessionId: session.id, path: session.logPath })
    } else {
      let expected = null
      try {
        expected = projectKey(header.cwd)
      } catch {
        expected = null
      }
      if (expected !== null && expected !== session.projectKey) {
        push({ code: 'cwd-mismatch', severity: 'error', message: `header.cwd 指向 ${header.cwd}，但目录是 ${session.projectKey}`, sessionId: session.id, path: session.dir })
      }
    }
    const copies = byId.get(session.id) ?? []
    if (copies.length > 1) {
      const others = copies.filter((entry) => entry.dir !== session.dir).map((entry) => entry.dir)
      push({ code: 'duplicate-session', severity: 'error', message: `同一 sessionId 存在 ${copies.length} 份（另一份：${others.join(', ')}）`, sessionId: session.id, path: session.dir })
    }
  }

  const accounted = new Set()
  for (const workspace of workspaces) {
    if (workspace.missingRecord === true) {
      push({ code: 'missing-workspace-record', severity: 'warn', message: `workspaceIds 里的 ${workspace.id} 在 tables.workspaces 中不存在`, workspaceId: workspace.id })
      continue
    }
    if (workspace.dirExists === false) {
      push({ code: 'missing-workspace-dir', severity: 'warn', message: `工作区目录不存在：${workspace.path}`, workspaceId: workspace.id, path: workspace.path })
    }
    for (const sessionId of workspace.sessionIds) {
      accounted.add(sessionId)
      if (!byId.has(sessionId)) {
        push({ code: 'dangling-reference', severity: 'error', message: `工作区「${workspace.title || workspace.path}」引用了不存在的会话 ${sessionId}`, sessionId, workspaceId: workspace.id, fixable: true })
      }
    }
  }

  for (const session of sessions) {
    if (accounted.has(session.id)) continue
    const header = session.header ?? {}
    if (header.parentSession !== undefined || header.origin === 'subagent' || (typeof header.delegationDepth === 'number' && header.delegationDepth > 0)) continue
    push({ code: 'orphan-session', severity: 'warn', message: '会话没有被任何工作区登记，界面上不会出现', sessionId: session.id, path: session.dir })
  }

  for (const entry of pending) {
    push({ code: 'pending-migration', severity: 'info', message: `待补写归属：${entry.id} → ${entry.toPath}`, sessionId: entry.id, path: entry.toPath })
  }

  return issues
}
