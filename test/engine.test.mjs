import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

import { Engine, AppError } from '../lib/engine.js'
import { compareBodies, readHeader } from '../lib/frames.js'
import { canonicalize, currentLogFilename, encodeSegment, projectKey, sessionDir } from '../lib/paths.js'
import { hasZstd } from '../lib/frames.js'

const skip = hasZstd() ? false : 'this Node build has no zstd support'

const SESSION_ID = 'session-0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'

/**
 * @param {object} header header object.
 * @param {number} events trailing event frames.
 * @returns {Buffer} log bytes.
 */
function buildLog(header, events) {
  const frame = (value) => Buffer.from(zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')))
  const parts = [frame(header)]
  for (let index = 0; index < events; index++) parts.push(frame({ type: 'turn/start', seq: index, data: { turn: index } }))
  return Buffer.concat(parts)
}

/**
 * Create a throwaway DSH home plus two directories, all canonical.
 * @param {string} label test label.
 * @returns {object} fixture.
 */
function fixture(label) {
  const root = canonicalize(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `dsm-${label}-`))))
  const home = path.join(root, '.dsh')
  const sessionsRoot = path.join(home, 'sessions')
  fs.mkdirSync(sessionsRoot, { recursive: true })
  const from = path.join(root, 'from-dir')
  const to = path.join(root, 'to-dir')
  fs.mkdirSync(from, { recursive: true })
  fs.mkdirSync(to, { recursive: true })
  const ctx = { get: () => undefined, logger: { info() {}, warn() {} } }
  const engine = new Engine(ctx, { dshHome: home })
  return { root, home, sessionsRoot, from, to, engine }
}

/**
 * Write one stored session.
 * @param {string} sessionsRoot sessions root.
 * @param {string} cwd project directory.
 * @param {string} id session id.
 * @param {number} events trailing events.
 * @returns {{logPath: string, bytes: Buffer}} written log.
 */
function writeSession(sessionsRoot, cwd, id, events) {
  const dir = sessionDir(sessionsRoot, cwd, id)
  fs.mkdirSync(dir, { recursive: true })
  const logPath = path.join(dir, currentLogFilename())
  const bytes = buildLog(
    { type: 'session', version: 4, id, createdAt: 1792155157986, cwd, isSeeded: false, delegationDepth: 0, agentPreset: 'ptc' },
    events,
  )
  fs.writeFileSync(logPath, bytes)
  return { logPath, bytes }
}

test('move relocates data, rewrites only the header frame, verifies and keeps a backup', { skip }, async () => {
  const { root, home, sessionsRoot, from, to, engine } = fixture('move')
  try {
    const written = writeSession(sessionsRoot, from, SESSION_ID, 5)

    const plan = await engine.plan({ sessionId: SESSION_ID, toPath: to })
    assert.equal(plan.ok, true)
    assert.equal(plan.fromPath, from)
    assert.equal(plan.toPath, to)
    assert.equal(plan.sourceKey, projectKey(from))
    assert.equal(plan.targetKey, projectKey(to))
    assert.equal(plan.headerCwd, from)
    assert.equal(plan.newHeaderCwd, to)
    assert.equal(plan.workspaceId, null)
    assert.equal(plan.willCreateWorkspace, true)

    const result = await engine.move({ sessionId: SESSION_ID, toPath: to })
    assert.equal(result.ok, true)
    assert.equal(result.verify.ok, true)
    assert.equal(result.verify.equal, true)
    assert.equal(result.backupPath !== null, true)
    assert.equal(fs.existsSync(result.backupPath), true)

    assert.equal(fs.existsSync(sessionDir(sessionsRoot, from, SESSION_ID)), false, 'source directory is gone')
    const targetLog = path.join(sessionDir(sessionsRoot, to, SESSION_ID), currentLogFilename())
    assert.equal(fs.existsSync(targetLog), true)

    const after = readHeader(fs.readFileSync(targetLog))
    assert.equal(after.header.cwd, to)
    assert.equal(after.header.id, SESSION_ID)
    assert.equal(after.header.agentPreset, 'ptc', 'every other header field survives')
    assert.equal(after.frameCount, 6)

    const comparison = compareBodies(written.bytes, fs.readFileSync(targetLog))
    assert.equal(comparison.equal, true, 'history after frame 1 is byte-identical')
    assert.equal(fs.existsSync(`${targetLog}.bak`), true, 'the pre-rewrite log stays beside it')
    assert.ok(result.rollbackCommands.length > 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a second move is a safe no-op refusal, never a second copy', { skip }, async () => {
  const { root, sessionsRoot, from, to, engine } = fixture('idempotent')
  try {
    writeSession(sessionsRoot, from, SESSION_ID, 2)
    await engine.move({ sessionId: SESSION_ID, toPath: to })
    await assert.rejects(
      () => engine.move({ sessionId: SESSION_ID, toPath: to }),
      (error) => error instanceof AppError && error.code === 'same-target',
    )
    const copies = fs.readdirSync(sessionsRoot).flatMap((key) => {
      const candidate = path.join(sessionsRoot, key, encodeSegment(SESSION_ID))
      return fs.existsSync(candidate) ? [candidate] : []
    })
    assert.equal(copies.length, 1, 'exactly one copy of the session id exists')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('an existing target directory is refused before anything is written', { skip }, async () => {
  const { root, sessionsRoot, from, to, engine } = fixture('conflict')
  try {
    const written = writeSession(sessionsRoot, from, SESSION_ID, 3)
    const occupied = sessionDir(sessionsRoot, to, SESSION_ID)
    fs.mkdirSync(occupied, { recursive: true })
    fs.writeFileSync(path.join(occupied, 'occupied.txt'), 'do not touch')

    await assert.rejects(
      () => engine.move({ sessionId: SESSION_ID, toPath: to }),
      (error) => error instanceof AppError && error.code === 'target-exists',
    )
    assert.equal(fs.existsSync(sessionDir(sessionsRoot, from, SESSION_ID)), true, 'data untouched')
    assert.equal(fs.readFileSync(written.logPath).equals(written.bytes), true, 'log untouched')
    assert.equal(fs.readFileSync(path.join(occupied, 'occupied.txt'), 'utf8'), 'do not touch')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the working-directory contents move only with an explicit opt-in', { skip }, async () => {
  const { root, sessionsRoot, from, to, engine } = fixture('files')
  try {
    writeSession(sessionsRoot, from, SESSION_ID, 1)
    fs.mkdirSync(path.join(from, 'notes'))
    fs.writeFileSync(path.join(from, 'notes', 'todo.md'), '# todo')
    fs.writeFileSync(path.join(from, 'app.js'), 'console.log(1)')

    const plan = await engine.plan({ sessionId: SESSION_ID, toPath: to, moveFiles: true })
    assert.equal(plan.files.enabled, true)
    assert.equal(plan.files.blocked, false)
    assert.deepEqual(plan.files.entries.sort(), ['app.js', 'notes'])

    const result = await engine.move({ sessionId: SESSION_ID, toPath: to, moveFiles: true })
    assert.equal(result.ok, true)
    assert.equal(fs.existsSync(path.join(to, 'app.js')), true)
    assert.equal(fs.readFileSync(path.join(to, 'notes', 'todo.md'), 'utf8'), '# todo')
    assert.equal(fs.existsSync(path.join(from, 'app.js')), false)
    assert.equal(fs.existsSync(from), true, 'the old directory stays, empty, so the old workspace stays valid')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a file clash blocks the plan instead of merging', { skip }, async () => {
  const { root, sessionsRoot, from, to, engine } = fixture('clash')
  try {
    writeSession(sessionsRoot, from, SESSION_ID, 1)
    fs.writeFileSync(path.join(from, 'same.txt'), 'source')
    fs.writeFileSync(path.join(to, 'same.txt'), 'target')

    const plan = await engine.plan({ sessionId: SESSION_ID, toPath: to, moveFiles: true })
    assert.equal(plan.files.blocked, true)
    assert.deepEqual(plan.files.conflicts, ['same.txt'])
    await assert.rejects(
      () => engine.move({ sessionId: SESSION_ID, toPath: to, moveFiles: true }),
      (error) => error instanceof AppError && error.code === 'files-plan-blocked',
    )
    assert.equal(fs.readFileSync(path.join(to, 'same.txt'), 'utf8'), 'target')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a live session refuses to migrate itself', { skip }, async () => {
  const { root, sessionsRoot, from, to, engine } = fixture('live')
  try {
    writeSession(sessionsRoot, from, SESSION_ID, 1)
    engine.liveSessionIds = () => new Set([SESSION_ID])
    await assert.rejects(
      () => engine.move({ sessionId: SESSION_ID, toPath: to }),
      (error) => error instanceof AppError && error.code === 'session-live',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('doctor reports a header/directory mismatch', { skip }, async () => {
  const { root, sessionsRoot, from, engine } = fixture('doctor')
  try {
    writeSession(sessionsRoot, from, SESSION_ID, 1)
    const misplaced = path.join(sessionsRoot, projectKey('C:\\somewhere\\else'), encodeSegment(SESSION_ID))
    fs.mkdirSync(path.dirname(misplaced), { recursive: true })
    fs.cpSync(path.join(sessionsRoot, projectKey(from), encodeSegment(SESSION_ID)), misplaced, { recursive: true })

    const report = await engine.doctor()
    assert.equal(report.ok, true)
    const codes = report.issues.map((issue) => issue.code)
    assert.ok(codes.includes('cwd-mismatch'))
    assert.ok(codes.includes('duplicate-session'))
    assert.ok(report.summary.errors >= 2)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('export copies a session without touching the registry', { skip }, async () => {
  const { root, sessionsRoot, from, engine } = fixture('export')
  try {
    writeSession(sessionsRoot, from, SESSION_ID, 2)
    const result = await engine.exportSession({ sessionId: SESSION_ID, outDir: path.join(root, 'out') })
    assert.equal(result.ok, true)
    assert.equal(fs.existsSync(path.join(result.path, currentLogFilename())), true)
    assert.equal(fs.existsSync(path.join(result.path, 'migration-export.json')), true)
    const manifest = JSON.parse(fs.readFileSync(path.join(result.path, 'migration-export.json'), 'utf8'))
    assert.equal(manifest.sessionId, SESSION_ID)
    assert.equal(manifest.cwd, from)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('applyPending is a no-op without a journal and with no registry', { skip }, async () => {
  const { root, engine } = fixture('pending')
  try {
    const result = await engine.applyPending()
    assert.deepEqual(result.applied, [])
    assert.deepEqual(result.remaining, [])
    assert.deepEqual(engine.readPending(), [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('plan rejects a relative target and a missing directory', { skip }, async () => {
  const { root, sessionsRoot, from, engine } = fixture('bad-target')
  try {
    writeSession(sessionsRoot, from, SESSION_ID, 1)
    await assert.rejects(
      () => engine.plan({ sessionId: SESSION_ID, toPath: 'relative\\dir' }),
      (error) => error instanceof AppError && error.code === 'path-not-absolute',
    )
    await assert.rejects(
      () => engine.plan({ sessionId: SESSION_ID, toPath: path.join(root, 'nope') }),
      (error) => error instanceof AppError && error.code === 'target-missing',
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
