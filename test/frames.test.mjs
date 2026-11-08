import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

import {
  compareBodies,
  countFramesFile,
  firstFrameEnd,
  frameOffsets,
  hasZstd,
  readHeader,
  readHeaderFile,
  replaceHeaderFrame,
} from '../lib/frames.js'

const skip = hasZstd() ? false : 'this Node build has no zstd support'

/**
 * Compress one JSONL line into a standalone zstd frame.
 * @param {object|string} value value to encode.
 * @returns {Buffer} one frame.
 */
function frame(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return Buffer.from(zlib.zstdCompressSync(Buffer.from(`${text}\n`, 'utf8')))
}

/**
 * Build a log made of independent frames.
 * @param {object} header header object.
 * @param {number} events number of trailing event frames.
 * @returns {Buffer} log bytes.
 */
function buildLog(header, events) {
  const parts = [frame(header)]
  for (let index = 0; index < events; index++) parts.push(frame({ type: 'turn/start', seq: index, data: { turn: index } }))
  return Buffer.concat(parts)
}

test('frame geometry: walk, magic scan and first-frame end agree', { skip }, () => {
  const log = buildLog({ type: 'session', version: 4, id: 'session-a', cwd: 'C:\\old' }, 5)
  const geometry = frameOffsets(log)
  assert.equal(geometry.strict, true)
  assert.equal(geometry.offsets.length, 6)
  assert.equal(geometry.offsets[0], 0)
  assert.equal(firstFrameEnd(log), geometry.offsets[1])
  for (const offset of geometry.offsets) assert.equal(log.readUInt32LE(offset), 0xfd2fb528)
})

test('a single decompress only ever yields the header frame', { skip }, () => {
  const log = buildLog({ type: 'session', version: 4, id: 'session-b', cwd: 'C:\\x' }, 3)
  const text = zlib.zstdDecompressSync(log).toString('utf8')
  assert.equal(text.trim().split('\n').length, 1, 'the trap this plugin exists to avoid')
  assert.equal(JSON.parse(text).id, 'session-b')
})

test('readHeader parses the first line and reports frame count', { skip }, () => {
  const log = buildLog({ type: 'session', version: 4, id: 'session-c', cwd: 'C:\\y' }, 4)
  const parsed = readHeader(log)
  assert.equal(parsed.headerError, null)
  assert.equal(parsed.header.id, 'session-c')
  assert.equal(parsed.frameCount, 5)
  assert.equal(parsed.strict, true)
})

test('replaceHeaderFrame keeps every byte after the first frame', { skip }, () => {
  const log = buildLog({ type: 'session', version: 4, id: 'session-d', cwd: 'C:\\old' }, 4)
  const original = readHeader(log).header
  const rewritten = replaceHeaderFrame(log, { ...original, cwd: 'C:\\a\\much\\longer\\target\\path' })
  const after = readHeader(rewritten.buffer)
  assert.equal(after.header.cwd, 'C:\\a\\much\\longer\\target\\path')
  assert.equal(after.header.id, 'session-d')
  assert.equal(after.frameCount, 5)

  const comparison = compareBodies(log, rewritten.buffer)
  assert.equal(comparison.comparable, true)
  assert.equal(comparison.equal, true, 'frame 2 onward is byte-identical')
  assert.equal(comparison.addedBytes, 0)
  assert.ok(rewritten.newFrameBytes > rewritten.oldFrameBytes, 'a longer path grows the header frame only')
})

test('compareBodies reports bytes appended after the migration', { skip }, () => {
  const before = buildLog({ type: 'session', version: 4, id: 'session-e', cwd: 'C:\\old' }, 3)
  const migrated = replaceHeaderFrame(before, { type: 'session', version: 4, id: 'session-e', cwd: 'C:\\new' }).buffer
  const after = Buffer.concat([migrated, frame({ type: 'turn/start', seq: 3, data: { turn: 3 } })])
  const comparison = compareBodies(before, after)
  assert.equal(comparison.equal, true)
  assert.ok(comparison.addedBytes > 0)
  assert.equal(comparison.afterFrames, comparison.beforeFrames + 1)
})

test('compareBodies detects a changed body byte', { skip }, () => {
  const before = buildLog({ type: 'session', version: 4, id: 'session-f', cwd: 'C:\\old' }, 3)
  const tampered = Buffer.from(before)
  tampered[tampered.length - 1] ^= 0xff
  const comparison = compareBodies(before, tampered)
  assert.equal(comparison.equal, false)
})

test('header-only logs are comparable but not body-comparable', { skip }, () => {
  const log = buildLog({ type: 'session', version: 4, id: 'session-g', cwd: 'C:\\old' }, 0)
  const comparison = compareBodies(log, log)
  assert.equal(comparison.comparable, false)
  assert.equal(comparison.beforeFrames, 1)
})

test('file helpers read a header and count frames without loading the log', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsm-frames-'))
  try {
    const file = path.join(dir, 'session.v4.jsonl.zstd')
    const log = buildLog({ type: 'session', version: 4, id: 'session-h', cwd: 'C:\\z' }, 6)
    fs.writeFileSync(file, log)

    const head = readHeaderFile(file, fs)
    assert.equal(head.headerError, null)
    assert.equal(head.header.id, 'session-h')
    assert.equal(head.sizeBytes, log.length)

    assert.equal(countFramesFile(file, fs), 7)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty file is reported, never treated as a session', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsm-frames-empty-'))
  try {
    const file = path.join(dir, 'session.v4.jsonl.zstd')
    fs.writeFileSync(file, '')
    const head = readHeaderFile(file, fs)
    assert.equal(head.header, null)
    assert.match(head.headerError, /empty/)
    assert.equal(readHeader(Buffer.alloc(0)).headerError, 'log is empty')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
