/**
 * The migration engine: plan, move, verify, relocate workspace files, export,
 * doctor and the deferred workspace-accounting queue.
 *
 * Invariants this module enforces (each one guards a real crash mode):
 *
 *   - Move, never copy. A second copy of one sessionId makes the App's startup
 *     scan ambiguous, so an existing target directory is always a refusal.
 *   - Data first, registry second. `workspace.json` may never point at a session
 *     directory that does not exist yet; while DSH runs, the live registry
 *     Service is the only writer, so nothing here edits that file by hand.
 *   - Only frame 1 of the log changes. `zstdDecompressSync` returns the first
 *     frame only, so "decompress the log, edit, recompress" would silently
 *     discard the entire history. The header frame is replaced and every later
 *     byte is preserved, then checked byte for byte.
 *   - Every failure path rolls back, and prints the commands to finish by hand.
 *   - A session with a live agent (its log is open) can never migrate itself.
 *
 * @module dsh-session-migration/engine
 */

import fs from 'node:fs'
import path from 'node:path'

import { compareBodies, hasZstd, readHeaderFile, replaceHeaderFrame } from './frames.js'
import {
  canonicalize,
  canonicalizeLoose,
  currentLogFilename,
  encodeSegment,
  isFullyQualified,
  isInside,
  logPath,
  projectKey,
  resolveDshHome,
  resolvePluginDataDir,
  resolveSessionsRoot,
  resolveStoragesRoot,
  samePath,
  sessionDir,
} from './paths.js'
import { collectIssues, findLogFile, readRegistryRaw, registryRecords, scanSessions } from './scan.js'

const PENDING_UNIT = { name: 'dsh-session-migration-pending', version: 1 }

/** An error carrying a stable code and optional structured detail. */
export class AppError extends Error {
  /**
   * @param {string} code stable machine code.
   * @param {string} message human message.
   * @param {object} [details] extra fields for the UI.
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

/**
 * Copy a directory tree, refusing to merge into an existing one.
 * @param {string} from source directory.
 * @param {string} to destination directory.
 */
function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false, dereference: false })
}

/**
 * Move one file or directory, degrading to copy + delete across volumes.
 * @param {string} from source path.
 * @param {string} to destination path.
 * @returns {'rename'|'copy'} which strategy succeeded.
 */
function moveEntry(from, to) {
  try {
    fs.renameSync(from, to)
    return 'rename'
  } catch (error) {
    if (error?.code !== 'EXDEV' && error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error
    copyDir(from, to)
    fs.rmSync(from, { recursive: true, force: true })
    return 'copy'
  }
}

/**
 * Write a JSON document atomically (temporary file + rename).
 * @param {string} file destination path.
 * @param {object} value JSON-serializable value.
 */
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

/**
 * Bounded recursive size of a directory, in bytes.
 * @param {string} dir directory to measure.
 * @param {{ limit?: number }} [options] stop after this many entries.
 * @returns {{ bytes: number, entries: number, truncated: boolean }} measurement.
 */
function measure(dir, options = {}) {
  const limit = options.limit ?? 20_000
  let bytes = 0
  let entries = 0
  let truncated = false
  const walk = (current) => {
    if (truncated) return
    let list = []
    try {
      list = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of list) {
      if (truncated) return
      entries += 1
      if (entries > limit) {
        truncated = true
        return
      }
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        try {
          bytes += fs.statSync(full).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(dir)
  return { bytes, entries, truncated }
}

/** Default plugin configuration. */
const DEFAULT_CONFIG = Object.freeze({
  /** Keep a full copy of the session directory before touching it. */
  backupBeforeMove: true,
  /** How many automatic backups to retain. */
  keepBackups: 10,
  /** Try to write workspace membership immediately even though the live index is cached. */
  tryImmediateAttach: true,
  /** Apply deferred membership writes this long after Host start. */
  pendingApplyDelayMs: 2500,
})

/** Migration engine bound to one Host context. */
export class Engine {
  /**
   * @param {object} ctx Cordis plugin context.
   * @param {object} [config] row config from `cordis.patch.yml`.
   */
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.config = { ...DEFAULT_CONFIG, ...(config ?? {}) }
    this.home = resolveDshHome(this.config.dshHome)
    this.sessionsRoot = resolveSessionsRoot(this.home, this.config)
    this.storagesRoot = resolveStoragesRoot(this.home)
    this.dataDir = resolvePluginDataDir(this.home)
    this.frameCache = new Map()
    this.busy = new Set()
    this.lastApply = null
  }

  // ---------------------------------------------------------------- services

  /** @returns {object|undefined} live workspace registry Service. */
  registry() {
    try {
      return this.ctx.get('workspaceRegistry')
    } catch {
      return undefined
    }
  }

  /**
   * Ids of sessions that currently have a live agent (their log is open).
   * @returns {Set<string>} live session ids.
   */
  liveSessionIds() {
    const ids = new Set()
    try {
      const agents = this.ctx.get('agents')
      if (agents && typeof agents.list === 'function') {
        for (const agent of agents.list()) {
          const id = agent?.session?.id ?? agent?.sessionId ?? agent?.id
          if (typeof id === 'string') ids.add(id)
        }
      }
    } catch {
      /* liveness is advisory */
    }
    return ids
  }

  /**
   * Live registry view, with each workspace's filtered session ids.
   * @returns {Promise<Array<{id: string, path: string, title: string, sessionIds: string[], status: string}>>} workspaces.
   */
  async liveWorkspaces() {
    const registry = this.registry()
    if (registry === undefined || typeof registry.list !== 'function') return []
    const list = registry.list()
    return Promise.all(
      list.map(async (workspace) => {
        let status = 'unknown'
        try {
          status = await workspace.status()
        } catch {
          status = 'unknown'
        }
        return {
          id: workspace.id,
          path: workspace.path,
          title: workspace.title,
          sessionIds: [...workspace.sessionIds],
          status,
        }
      }),
    )
  }

  // ------------------------------------------------------------------ pending

  /** @returns {string} absolute path of the deferred-membership journal. */
  pendingFile() {
    return path.join(this.dataDir, 'pending.json')
  }

  /** @returns {Array<object>} pending membership writes. */
  readPending() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.pendingFile(), 'utf8'))
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : []
      return entries.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
    } catch {
      return []
    }
  }

  /**
   * @param {Array<object>} entries pending entries to persist.
   */
  writePending(entries) {
    writeJsonAtomic(this.pendingFile(), { unit: PENDING_UNIT, entries })
  }

  /**
   * Queue one deferred membership write, replacing an older entry for the same id.
   * @param {{id: string, fromPath: string, toPath: string, sessionDir: string}} entry journal entry.
   * @returns {object} stored entry.
   */
  queuePending(entry) {
    const entries = this.readPending().filter((item) => item.id !== entry.id)
    const next = { ...entry, movedAt: new Date().toISOString(), attempts: 0, lastError: null }
    entries.push(next)
    this.writePending(entries)
    return next
  }

  /**
   * Try to write the queued workspace memberships now.
   * @returns {Promise<{applied: object[], remaining: object[]}>} outcome.
   */
  async applyPending() {
    const entries = this.readPending()
    if (entries.length === 0) {
      this.lastApply = { applied: [], remaining: [], at: new Date().toISOString() }
      return { applied: [], remaining: [] }
    }
    const registry = this.registry()
    const applied = []
    const remaining = []
    if (registry === undefined) {
      this.lastApply = { applied, remaining: entries, error: 'workspaceRegistry Service unavailable', at: new Date().toISOString() }
      return { applied, remaining: entries }
    }
    for (const entry of entries) {
      try {
        const dir = sessionDir(this.sessionsRoot, entry.toPath, entry.id)
        const log = findLogFile(dir)
        if (log === null) throw new AppError('missing-log', `目标会话目录里没有日志：${dir}`)
        const head = readHeaderFile(log.path, fs)
        if (head.header === null) throw new AppError('unreadable-log', `目标日志无法读取：${head.headerError}`)
        const headerCwd = typeof head.header.cwd === 'string' ? head.header.cwd : null
        if (headerCwd === null || !samePath(canonicalizeLoose(headerCwd), entry.toPath)) {
          throw new AppError('header-not-migrated', `header.cwd 与目标不符（${headerCwd ?? '缺失'}）`)
        }
        let workspace = await registry.resolveByPath(entry.toPath)
        if (workspace === undefined) workspace = await registry.create(entry.toPath)
        await workspace.attachSession(entry.id)
        await this.detachEverywhere(entry.id, workspace.id)
        applied.push({ id: entry.id, workspaceId: workspace.id, toPath: entry.toPath })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        remaining.push({ ...entry, attempts: (entry.attempts ?? 0) + 1, lastError: message })
      }
    }
    this.writePending(remaining)
    this.lastApply = { applied, remaining, at: new Date().toISOString() }
    return { applied, remaining }
  }

  /**
   * Remove a session id from every workspace record except the keeper.
   * @param {string} sessionId session id.
   * @param {string} [keepWorkspaceId] workspace to keep.
   */
  async detachEverywhere(sessionId, keepWorkspaceId) {
    const registry = this.registry()
    if (registry === undefined) return
    for (const workspace of registry.list()) {
      if (workspace.id === keepWorkspaceId) continue
      if (!workspace.sessionIds.includes(sessionId)) continue
      try {
        await workspace.detachSession(sessionId)
      } catch {
        /* a stale accounting slot is harmless once the cwd disagrees */
      }
    }
  }

  // ------------------------------------------------------------------ snapshot

  /**
   * Full read-only snapshot for the panel.
   * @returns {Promise<object>} snapshot payload.
   */
  async snapshot() {
    const sessions = await scanSessions(this.sessionsRoot, { withFrames: true, frameCache: this.frameCache })
    const raw = readRegistryRaw(this.storagesRoot)
    const rawWorkspaces = registryRecords(raw.data)
    const live = this.liveSessionIds()
    const membership = new Map()
    for (const workspace of rawWorkspaces) {
      for (const id of workspace.sessionIds) {
        const list = membership.get(id)
        if (list === undefined) membership.set(id, [{ id: workspace.id, title: workspace.title, path: workspace.path }])
        else list.push({ id: workspace.id, title: workspace.title, path: workspace.path })
      }
    }
    const pending = this.readPending()
    const issues = collectIssues({ sessions, workspaces: rawWorkspaces, pending })
    const issuesBySession = new Map()
    for (const issue of issues) {
      if (typeof issue.sessionId !== 'string') continue
      const list = issuesBySession.get(issue.sessionId)
      if (list === undefined) issuesBySession.set(issue.sessionId, [{ code: issue.code, severity: issue.severity }])
      else list.push({ code: issue.code, severity: issue.severity })
    }
    const duplicates = new Map()
    for (const session of sessions) duplicates.set(session.id, (duplicates.get(session.id) ?? 0) + 1)

    let liveList = []
    try {
      liveList = await this.liveWorkspaces()
    } catch {
      liveList = []
    }

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      home: this.home,
      sessionsRoot: this.sessionsRoot,
      sessionsRootExists: fs.existsSync(this.sessionsRoot),
      registryPath: raw.path,
      registryError: raw.error,
      platform: process.platform,
      node: process.versions.node,
      zstd: hasZstd(),
      liveWorkspaces: liveList,
      workspaces: rawWorkspaces.map((workspace) => ({
        ...workspace,
        liveSessionCount: liveList.find((item) => item.id === workspace.id)?.sessionIds.length ?? null,
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        dir: session.dir,
        projectKey: session.projectKey,
        cwd: session.cwd,
        sizeBytes: session.sizeBytes,
        frames: session.frames,
        mtime: session.mtime,
        formatVersion: session.formatVersion,
        headerError: session.headerError,
        agentPreset: session.header?.agentPreset ?? null,
        parentSession: session.header?.parentSession ?? null,
        delegationDepth: session.header?.delegationDepth ?? null,
        live: live.has(session.id),
        duplicate: (duplicates.get(session.id) ?? 0) > 1,
        workspaceIds: (membership.get(session.id) ?? []).map((item) => item.id),
        workspaceTitles: (membership.get(session.id) ?? []).map((item) => item.title || item.path),
        issues: issuesBySession.get(session.id) ?? [],
      })),
      pending,
      pendingApply: this.lastApply,
      issues,
    }
  }

  /**
   * Build a dry-run plan for moving one session.
   * @param {{sessionId: string, toPath: string, moveFiles?: boolean, createTargetDir?: boolean, allowSharedSource?: boolean}} input request.
   * @returns {Promise<object>} plan payload.
   */
  async plan(input) {
    const sessionId = requireString(input.sessionId, 'sessionId')
    const toPathRaw = requireString(input.toPath, 'toPath')
    if (!isFullyQualified(toPathRaw)) throw new AppError('path-not-absolute', `目标路径必须是完整路径：${toPathRaw}`)

    const sessions = await scanSessions(this.sessionsRoot, { withFrames: false, withHeader: true })
    const matches = sessions.filter((session) => session.id === sessionId && session.logPath !== null)
    if (matches.length === 0) {
      const orphan = sessions.find((session) => session.id === sessionId)
      if (orphan !== undefined) throw new AppError('missing-log', `会话目录里没有日志：${orphan.dir}`, { dir: orphan.dir })
      throw new AppError('session-not-found', `找不到会话 ${sessionId}`)
    }
    if (matches.length > 1) {
      throw new AppError('duplicate-session', `会话 ${sessionId} 在磁盘上存在 ${matches.length} 份，请先清理重复项`, {
        dirs: matches.map((session) => session.dir),
      })
    }
    const session = matches[0]
    if (session.headerError !== null || session.header === null) {
      throw new AppError('unreadable-log', `无法读取会话 header：${session.headerError}`, { dir: session.dir })
    }
    if (this.liveSessionIds().has(sessionId)) {
      throw new AppError('session-live', '该会话正在使用中（日志被占用），无法自迁。请先切换到其它会话或重启 DSH 后再迁移。')
    }
    if (this.busy.has(sessionId)) throw new AppError('session-busy', '该会话正在迁移中')

    const fromPath = typeof session.header.cwd === 'string' && session.header.cwd.length > 0 ? canonicalizeLoose(session.header.cwd) : null
    if (fromPath === null) throw new AppError('missing-cwd', '会话 header 里没有 cwd，无法判断迁移目标')

    const targetExists = fs.existsSync(toPathRaw)
    let toPath
    let willCreateDir = false
    if (targetExists) {
      const stat = fs.statSync(toPathRaw)
      if (!stat.isDirectory()) throw new AppError('target-not-directory', `目标不是目录：${toPathRaw}`)
      toPath = canonicalize(toPathRaw)
    } else if (input.createTargetDir === true) {
      toPath = canonicalizeLoose(toPathRaw)
      willCreateDir = true
    } else {
      throw new AppError('target-missing', `目标目录不存在：${toPathRaw}（可以勾选「自动创建目标目录」）`)
    }
    if (samePath(fromPath, toPath)) throw new AppError('same-target', '目标与当前工作目录相同，无需迁移')

    const targetKey = projectKey(toPath)
    const sourceDir = session.dir
    const targetDir = sessionDir(this.sessionsRoot, toPath, sessionId)
    const targetConflict = fs.existsSync(targetDir)
    if (targetConflict) throw new AppError('target-exists', `目标会话目录已存在，为避免同一 sessionId 出现两份，已拒绝：${targetDir}`)

    const log = findLogFile(sourceDir)
    if (log === null) throw new AppError('missing-log', '会话目录里没有日志')

    let workspace = null
    const registry = this.registry()
    const rawWorkspaces = registryRecords(readRegistryRaw(this.storagesRoot).data)
    const registered = rawWorkspaces.find((item) => item.path !== '' && samePath(item.path, toPath))
    if (registry !== undefined) {
      try {
        workspace = (await registry.resolveByPath(toPath)) ?? null
      } catch {
        workspace = null
      }
    }
    const willCreateWorkspace = workspace === null && registered === undefined
    const sourceWorkspaces = rawWorkspaces.filter((item) => item.sessionIds.includes(sessionId))

    const filesPlan = this.planFiles({ moveFiles: input.moveFiles === true, fromPath, toPath, sessionId, sessions, allowSharedSource: input.allowSharedSource === true })

    return {
      ok: true,
      sessionId,
      fromPath,
      toPath,
      willCreateDir,
      sourceDir,
      targetDir,
      sourceKey: session.projectKey,
      targetKey,
      logPath: log.path,
      logFilename: log.filename,
      formatVersion: log.version,
      sizeBytes: session.sizeBytes,
      frames: session.frames,
      headerCwd: session.header.cwd,
      newHeaderCwd: toPath,
      workspaceId: workspace?.id ?? registered?.id ?? null,
      workspaceTitle: workspace?.title ?? registered?.title ?? null,
      willCreateWorkspace,
      currentWorkspaces: sourceWorkspaces.map((item) => ({ id: item.id, title: item.title, path: item.path })),
      files: filesPlan,
    }
  }

  /**
   * Plan the optional move of the source working-directory contents.
   * @param {object} input plan context.
   * @returns {object} files plan.
   */
  planFiles({ moveFiles, fromPath, toPath, sessionId, sessions, allowSharedSource }) {
    if (!moveFiles) return { enabled: false, entries: [], conflicts: [], blockers: [], bytes: 0, blocked: false }
    const problems = []
    if (!fs.existsSync(fromPath) || !fs.statSync(fromPath).isDirectory()) problems.push(`源目录不存在或不是目录：${fromPath}`)
    if (isInside(fromPath, toPath)) problems.push('目标目录位于源目录内部，无法搬运')
    if (isInside(toPath, fromPath)) problems.push('源目录位于目标目录内部，无法搬运')
    if (samePath(path.parse(fromPath).root, fromPath)) problems.push('源目录是磁盘根目录，拒绝搬运')
    if (isInside(fromPath, this.home) || samePath(fromPath, this.home)) problems.push('源目录包含 DSH 数据目录，拒绝搬运')
    const blockers = sessions
      .filter((session) => session.id !== sessionId && session.header !== null && typeof session.header.cwd === 'string' && samePath(canonicalizeLoose(session.header.cwd), fromPath))
      .map((session) => ({ id: session.id, dir: session.dir }))
    let entries = []
    let conflicts = []
    let bytes = 0
    let measured = { truncated: false }
    if (problems.length === 0) {
      try {
        entries = fs.readdirSync(fromPath, { withFileTypes: true }).map((entry) => entry.name)
      } catch (error) {
        problems.push(`无法读取源目录：${error instanceof Error ? error.message : String(error)}`)
      }
      for (const name of entries) {
        if (fs.existsSync(path.join(toPath, name))) conflicts.push(name)
        const stats = measure(path.join(fromPath, name))
        bytes += stats.bytes
        if (stats.truncated) measured.truncated = true
      }
      if (conflicts.length > 0) problems.push(`目标目录里已存在同名条目：${conflicts.slice(0, 8).join('、')}${conflicts.length > 8 ? ' …' : ''}`)
      if (blockers.length > 0 && allowSharedSource !== true) {
        problems.push(`还有 ${blockers.length} 个会话以该目录为工作目录，搬运会破坏它们；确认后勾选「仍然搬运」`)
      }
    }
    return {
      enabled: true,
      entries,
      entryCount: entries.length,
      conflicts,
      blockers,
      bytes,
      truncatedMeasure: measured.truncated,
      problems,
      blocked: problems.length > 0,
    }
  }

  /**
   * Execute a migration: data move, header rewrite, verification, optional
   * working-directory relocation, then workspace accounting.
   * @param {object} input request (same shape as {@link Engine.plan}).
   * @returns {Promise<object>} result payload.
   */
  async move(input) {
    const plan = await this.plan(input)
    const sessionId = plan.sessionId
    if (plan.files.enabled && plan.files.blocked) {
      throw new AppError('files-plan-blocked', '工作目录搬运前置检查未通过', { problems: plan.files.problems })
    }
    this.busy.add(sessionId)
    const steps = []
    const rollback = []
    let journal = null
    let headerRewritten = false
    let dirMoved = false
    let backupPath = null
    let movedFiles = []
    let createdWorkspace = null

    const note = (name, status, detail) => steps.push({ name, status, detail })

    try {
      // ---------------------------------------------------------------- backup
      if (this.config.backupBeforeMove !== false) {
        backupPath = path.join(this.dataDir, 'backups', `${timestamp()}-${encodeSegment(sessionId)}`)
        copyDir(plan.sourceDir, backupPath)
        note('backup', 'ok', backupPath)
        pruneBackups(this.dataDir, this.config.keepBackups ?? 10)
      } else {
        note('backup', 'skipped', '配置已关闭自动备份')
      }

      // ------------------------------------------------------------- data move
      fs.mkdirSync(path.dirname(plan.targetDir), { recursive: true })
      if (plan.willCreateDir) fs.mkdirSync(plan.toPath, { recursive: true })
      const strategy = moveEntry(plan.sourceDir, plan.targetDir)
      dirMoved = true
      const movedLog = path.join(plan.targetDir, plan.logFilename)
      if (!fs.existsSync(movedLog)) throw new AppError('move-incomplete', `迁移后目标日志不存在：${movedLog}`)
      const movedSize = fs.statSync(movedLog).size
      if (movedSize !== plan.sizeBytes) throw new AppError('move-size-mismatch', `迁移后日志大小不一致：${movedSize} != ${plan.sizeBytes}`)
      note('move-data', 'ok', `${strategy === 'rename' ? 'rename' : 'copy+delete'} → ${plan.targetDir}`)

      // ----------------------------------------------------- header rewrite
      const original = fs.readFileSync(movedLog)
      const geometry = readHeaderFile(movedLog, fs)
      if (geometry.header === null) throw new AppError('unreadable-log', `迁移后 header 无法读取：${geometry.headerError}`)
      const newHeader = { ...geometry.header, cwd: plan.toPath }
      const rewritten = replaceHeaderFrame(original, newHeader)
      const bak = `${movedLog}.bak`
      if (!fs.existsSync(bak)) fs.copyFileSync(movedLog, bak)
      const tmp = `${movedLog}.tmp`
      fs.writeFileSync(tmp, rewritten.buffer)
      fs.renameSync(tmp, movedLog)
      headerRewritten = true
      note('rewrite-header', 'ok', `header.cwd: ${plan.headerCwd} → ${plan.toPath}（仅第 1 帧，${rewritten.oldFrameBytes} → ${rewritten.newFrameBytes} 字节）`)

      // ----------------------------------------------------------- verification
      const after = fs.readFileSync(movedLog)
      const comparison = compareBodies(original, after)
      let verified = true
      if (comparison.comparable && !comparison.equal) {
        verified = false
        throw new AppError('verify-failed', '校验失败：第 2 帧起的字节与迁移前不一致，已回滚')
      }
      const recheck = readHeaderFile(movedLog, fs)
      if (recheck.header === null || !samePath(canonicalizeLoose(recheck.header.cwd), plan.toPath)) {
        verified = false
        throw new AppError('verify-failed', '校验失败：迁移后 header.cwd 读回不一致，已回滚')
      }
      note(
        'verify',
        'ok',
        comparison.comparable
          ? `第 2 帧起逐字节一致（比较 ${comparison.comparedBytes.toLocaleString('en-US')} 字节，帧数 ${comparison.beforeFrames} → ${comparison.afterFrames}）`
          : '日志只有 header 一帧，已校验 header 可解析且 cwd 正确',
      )

      // ------------------------------------------------ working-directory files
      if (plan.files.enabled) {
        try {
          for (const name of plan.files.entries) {
            moveEntry(path.join(plan.fromPath, name), path.join(plan.toPath, name))
            movedFiles.push(name)
          }
          note('move-files', 'ok', `${movedFiles.length} 个顶层条目：${plan.fromPath} → ${plan.toPath}`)
        } catch (error) {
          throw new AppError('files-failed', `工作目录搬运失败：${error instanceof Error ? error.message : String(error)}`)
        }
      } else {
        note('move-files', 'skipped', '未勾选搬运工作目录')
      }

      // -------------------------------------------------------------- accounting
      const registry = this.registry()
      let accounting = { status: 'unavailable', detail: 'workspaceRegistry Service 不可用' }
      if (registry !== undefined) {
        try {
          let workspace = await registry.resolveByPath(plan.toPath)
          if (workspace === undefined) {
            workspace = await registry.create(plan.toPath)
            createdWorkspace = { id: workspace.id, title: workspace.title, path: workspace.path }
          }
          let attached = false
          if (this.config.tryImmediateAttach !== false) {
            try {
              await workspace.attachSession(sessionId)
              attached = true
            } catch (error) {
              accounting = { status: 'deferred', detail: error instanceof Error ? error.message : String(error) }
            }
          }
          if (attached) {
            await this.detachEverywhere(sessionId, workspace.id)
            accounting = { status: 'attached', detail: `已归属工作区「${workspace.title}」` }
          } else {
            journal = this.queuePending({
              id: sessionId,
              fromPath: plan.fromPath,
              toPath: plan.toPath,
              sessionDir: plan.targetDir,
            })
            accounting = {
              status: 'pending-restart',
              detail: '数据已就位；工作区归属已排队，下次启动 DSH 时自动补写（运行中的工作区索引是启动时快照，无法热更新）',
              pendingFile: this.pendingFile(),
            }
          }
          note('workspace', accounting.status === 'attached' ? 'ok' : 'deferred', accounting.detail)
        } catch (error) {
          accounting = { status: 'failed', detail: error instanceof Error ? error.message : String(error) }
          note('workspace', 'failed', accounting.detail)
        }
      } else {
        note('workspace', 'failed', accounting.detail)
      }

      rollback.push(`# 回滚到迁移前（DSH 完全退出后执行）`)
      if (backupPath !== null) rollback.push(`Remove-Item -Recurse -Force "${plan.targetDir}"; Copy-Item -Recurse "${backupPath}" "${plan.targetDir}"`)

      return {
        ok: true,
        sessionId,
        fromPath: plan.fromPath,
        toPath: plan.toPath,
        sourceDir: plan.sourceDir,
        targetDir: plan.targetDir,
        backupPath,
        steps,
        verify: { ok: verified, ...comparison },
        accounting,
        pendingId: journal?.id ?? null,
        restartRequired: accounting.status !== 'attached',
        createdWorkspace,
        movedFiles,
        rollbackCommands: rollback,
      }
    } catch (error) {
      // ------------------------------------------------------------- rollback
      const failures = []
      if (movedFiles.length > 0) {
        for (const name of [...movedFiles].reverse()) {
          try {
            moveEntry(path.join(plan.toPath, name), path.join(plan.fromPath, name))
          } catch (rollbackError) {
            failures.push(`文件回搬失败 ${name}：${messageOf(rollbackError)}`)
          }
        }
      }
      if (headerRewritten) {
        const movedLog = path.join(plan.targetDir, plan.logFilename)
        const bak = `${movedLog}.bak`
        try {
          if (fs.existsSync(bak)) {
            const tmp = `${movedLog}.restore-tmp`
            fs.copyFileSync(bak, tmp)
            fs.renameSync(tmp, movedLog)
          }
        } catch (rollbackError) {
          failures.push(`header 回滚失败：${messageOf(rollbackError)}`)
        }
      }
      if (dirMoved) {
        try {
          if (fs.existsSync(plan.sourceDir)) {
            failures.push(`源目录已被占用，无法回搬：${plan.sourceDir}`)
          } else {
            moveEntry(plan.targetDir, plan.sourceDir)
          }
        } catch (rollbackError) {
          failures.push(`数据回搬失败：${messageOf(rollbackError)}`)
        }
      }
      if (createdWorkspace !== null) {
        try {
          await this.registry()?.delete(createdWorkspace.id)
        } catch {
          /* a created empty workspace is harmless */
        }
      }
      const partial = journal !== null
      if (partial) this.writePending(this.readPending().filter((entry) => entry.id !== sessionId))
      note('rollback', failures.length === 0 ? 'ok' : 'partial', failures.length === 0 ? '已逆序恢复到迁移前状态' : failures.join('；'))
      const failure = error instanceof AppError ? error : new AppError('move-failed', messageOf(error))
      throw new AppError(failure.code, failure.message, {
        ...failure.details,
        steps,
        rollbackCommands: rollback,
        backupPath,
      })
    } finally {
      this.busy.delete(sessionId)
    }
  }

  /**
   * Health check over the on-disk store and the raw registry document.
   * @returns {Promise<object>} doctor payload.
   */
  async doctor() {
    const sessions = await scanSessions(this.sessionsRoot, { withFrames: true, frameCache: this.frameCache })
    const raw = readRegistryRaw(this.storagesRoot)
    const workspaces = registryRecords(raw.data)
    const pending = this.readPending()
    const issues = collectIssues({ sessions, workspaces, pending })
    const summary = {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warn').length,
      infos: issues.filter((issue) => issue.severity === 'info').length,
      sessions: sessions.length,
      workspaces: workspaces.length,
      dangling: issues.filter((issue) => issue.code === 'dangling-reference').length,
    }
    return { ok: true, issues, summary, registryPath: raw.path, registryError: raw.error, pending }
  }

  /**
   * Remove registry references to sessions that do not exist on disk.
   * Runs through the live registry Service, so the durable document stays
   * consistent with the in-memory state.
   * @returns {Promise<object>} repair payload.
   */
  async repairDangling() {
    const registry = this.registry()
    if (registry === undefined) throw new AppError('registry-unavailable', 'workspaceRegistry Service 不可用')
    const sessions = await scanSessions(this.sessionsRoot, { withFrames: false, withHeader: false })
    const known = new Set(sessions.map((session) => session.id))
    const raw = readRegistryRaw(this.storagesRoot)
    const workspaces = registryRecords(raw.data)
    const removed = []
    const skipped = []
    for (const workspace of workspaces) {
      for (const sessionId of workspace.sessionIds) {
        if (known.has(sessionId)) {
          skipped.push({ workspaceId: workspace.id, sessionId, reason: '会话数据仍然存在，保留登记' })
          continue
        }
        const entity = registry.get(workspace.id)
        if (entity === undefined) {
          skipped.push({ workspaceId: workspace.id, sessionId, reason: '工作区未在运行中的注册表里激活' })
          continue
        }
        try {
          await entity.detachSession(sessionId)
          removed.push({ workspaceId: workspace.id, sessionId })
        } catch (error) {
          skipped.push({ workspaceId: workspace.id, sessionId, reason: messageOf(error) })
        }
      }
    }
    return { ok: true, removed, skipped }
  }

  /**
   * Copy a session directory to a backup/export destination without touching the
   * registry.
   * @param {{sessionId: string, outDir?: string}} input request.
   * @returns {Promise<object>} export payload.
   */
  async exportSession(input) {
    const sessionId = requireString(input.sessionId, 'sessionId')
    const sessions = await scanSessions(this.sessionsRoot, { withFrames: false, withHeader: true })
    const matches = sessions.filter((session) => session.id === sessionId && session.logPath !== null)
    if (matches.length === 0) throw new AppError('session-not-found', `找不到会话 ${sessionId}`)
    if (matches.length > 1) throw new AppError('duplicate-session', `会话 ${sessionId} 存在 ${matches.length} 份，请指定其中一份`)
    const session = matches[0]
    const outRoot = typeof input.outDir === 'string' && input.outDir.trim() !== '' ? path.resolve(input.outDir.trim()) : path.join(this.dataDir, 'exports')
    const target = path.join(outRoot, `${timestamp()}-${encodeSegment(sessionId)}`)
    if (fs.existsSync(target)) throw new AppError('target-exists', `导出目录已存在：${target}`)
    fs.mkdirSync(outRoot, { recursive: true })
    copyDir(session.dir, target)
    const stats = measure(target)
    const manifest = {
      exportedAt: new Date().toISOString(),
      sessionId,
      cwd: session.cwd,
      projectKey: session.projectKey,
      formatVersion: session.formatVersion,
      frames: session.frames,
      sizeBytes: session.sizeBytes,
      mtime: session.mtime,
    }
    writeJsonAtomic(path.join(target, 'migration-export.json'), manifest)
    return { ok: true, sessionId, path: target, bytes: stats.bytes, files: stats.entries, manifest }
  }

  // -------------------------------------------------------------------- HTTP

  /**
   * Dispatch one JSON API request.
   * @param {string} action action name.
   * @param {object} body request body.
   * @returns {Promise<object>} response payload.
   */
  async dispatch(action, body) {
    switch (action) {
      case 'ping':
        return { ok: true, pong: new Date().toISOString(), home: this.home, sessionsRoot: this.sessionsRoot }
      case 'snapshot':
        return this.snapshot()
      case 'plan':
        return this.plan(body)
      case 'move':
        return this.move(body)
      case 'doctor':
        return this.doctor()
      case 'repair':
        return this.repairDangling()
      case 'export':
        return this.exportSession(body)
      case 'applyPending':
        return { ok: true, ...(await this.applyPending()), pending: this.readPending() }
      case 'pending':
        return { ok: true, pending: this.readPending(), lastApply: this.lastApply }
      default:
        throw new AppError('unknown-action', `未知操作：${action}`)
    }
  }

  /**
   * HTTP route handler mounted at `/dsh-session-migration/api`.
   * @param {import('node:http').IncomingMessage} req request.
   * @param {import('node:http').ServerResponse} res response.
   */
  async handle(req, res) {
    const send = (status, payload) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(payload))
    }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      let body = {}
      if (req.method === 'POST') body = await readJsonBody(req)
      const action = typeof body.action === 'string' && body.action !== '' ? body.action : url.searchParams.get('action') ?? 'snapshot'
      const result = await this.dispatch(action, body)
      send(200, result)
    } catch (error) {
      if (error instanceof AppError) {
        send(400, { ok: false, error: { code: error.code, message: error.message, details: error.details } })
        return
      }
      send(500, { ok: false, error: { code: 'internal', message: messageOf(error) } })
    }
  }
}

/**
 * Read and parse a small JSON request body.
 * @param {import('node:http').IncomingMessage} req request.
 * @returns {Promise<object>} parsed body.
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) throw new AppError('body-too-large', '请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    throw new AppError('bad-json', '请求体不是合法 JSON')
  }
}

/**
 * Validate a required string field.
 * @param {unknown} value raw value.
 * @param {string} field field name for the message.
 * @returns {string} trimmed value.
 */
function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new AppError('invalid-input', `缺少参数：${field}`)
  return value.trim()
}

/**
 * Readable message from an unknown thrown value.
 * @param {unknown} error thrown value.
 * @returns {string} message.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Timestamp suitable for a directory name.
 * @returns {string} `YYYYMMDD-HHmmss`.
 */
function timestamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * Keep only the newest N automatic backups.
 * @param {string} dataDir plugin data directory.
 * @param {number} keep how many to retain.
 */
function pruneBackups(dataDir, keep) {
  const dir = path.join(dataDir, 'backups')
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  } catch {
    return
  }
  if (entries.length <= keep) return
  const sorted = entries
    .map((entry) => ({ name: entry.name, mtime: safeMtime(path.join(dir, entry.name)) }))
    .sort((a, b) => b.mtime - a.mtime)
  for (const entry of sorted.slice(keep)) {
    try {
      fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

/**
 * @param {string} target path to stat.
 * @returns {number} mtime in ms, or 0.
 */
function safeMtime(target) {
  try {
    return fs.statSync(target).mtimeMs
  } catch {
    return 0
  }
}

export { currentLogFilename, logPath }
