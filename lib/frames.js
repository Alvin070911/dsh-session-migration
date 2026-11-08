/**
 * Session log geometry: a DSH session log is a chain of independent zstd
 * frames, not one stream.
 *
 *   [frame 1: the one-line JSON header][frame 2][frame 3]…[frame N]
 *
 * Two consequences drive every function here:
 *
 *   1. `zlib.zstdDecompressSync(file)` returns only the FIRST frame, so any
 *      "decompress and measure" check reports a single header line and misreads
 *      a healthy multi-megabyte session as empty.
 *   2. Rewriting the header therefore must replace frame 1 only and keep every
 *      later byte untouched; recompressing decompressed text silently drops the
 *      rest of the history.
 *
 * Frame boundaries are found by walking the RFC 8878 frame/block headers, with
 * a magic-byte scan as a fallback for inputs that fail strict parsing.
 *
 * @module dsh-session-migration/frames
 */

import zlib from 'node:zlib'

/** zstd frame magic in file order (little-endian 0xFD2FB528). */
export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

const FRAME_HEADER_FCS_SIZES = [0, 2, 4, 8]
const DICT_ID_SIZES = [0, 1, 2, 4]

/**
 * Whether this Node build exposes zstd. Without it the plugin refuses to touch a
 * header instead of corrupting one.
 * @returns {boolean} true when zstd is available.
 */
export function hasZstd() {
  return typeof zlib.zstdCompressSync === 'function' && typeof zlib.zstdDecompressSync === 'function'
}

/**
 * End offset (exclusive) of the zstd frame starting at `start`.
 * @param {Buffer} buf containing buffer.
 * @param {number} start frame offset.
 * @returns {number} end offset, or -1 when the frame cannot be parsed.
 */
function parseFrameEnd(buf, start) {
  let p = start
  if (p + 5 > buf.length) return -1
  if (buf.readUInt32LE(p) !== 0xfd2fb528) return -1
  p += 4

  const fhd = buf[p]
  p += 1
  const fcsFlag = (fhd >> 6) & 3
  const singleSegment = (fhd >> 5) & 1
  const checksum = (fhd >> 2) & 1
  const dictFlag = fhd & 3

  if (!singleSegment) p += 1 // Window_Descriptor
  p += DICT_ID_SIZES[dictFlag]
  p += fcsFlag === 0 ? singleSegment : FRAME_HEADER_FCS_SIZES[fcsFlag]
  if (p > buf.length) return -1

  // Blocks, until the last-block flag: 3 header bytes, then the payload.
  for (let guard = 0; guard < 1_000_000; guard++) {
    if (p + 3 > buf.length) return -1
    const b0 = buf[p]
    const b1 = buf[p + 1]
    const b2 = buf[p + 2]
    const lastBlock = b0 & 1
    const blockType = (b0 >> 1) & 3
    const blockSize = (b0 >> 3) | (b1 << 5) | (b2 << 13)
    p += 3
    if (blockType === 1) p += 1 // RLE: one byte regenerated blockSize times
    else if (blockType === 0 || blockType === 2) p += blockSize // raw or compressed
    else return -1 // reserved block type
    if (p > buf.length) return -1
    if (lastBlock) break
  }

  if (checksum) p += 4
  return p <= buf.length ? p : -1
}

/**
 * Offsets of every frame by strict header walking.
 * @param {Buffer} buf log bytes.
 * @returns {number[]|null} frame offsets, or null when parsing failed.
 */
export function walkFrameOffsets(buf) {
  if (!Buffer.isBuffer(buf)) return null
  const offsets = []
  let p = 0
  while (p < buf.length) {
    const end = parseFrameEnd(buf, p)
    if (end <= p) return null
    offsets.push(p)
    p = end
  }
  return offsets
}

/**
 * Offsets of every zstd magic occurrence (approximate; used only as a fallback).
 * @param {Buffer} buf log bytes.
 * @returns {number[]} candidate offsets.
 */
export function scanFrameOffsets(buf) {
  const offsets = []
  if (!Buffer.isBuffer(buf)) return offsets
  for (let at = buf.indexOf(ZSTD_MAGIC); at !== -1; at = buf.indexOf(ZSTD_MAGIC, at + 1)) offsets.push(at)
  return offsets
}

/**
 * Frame offsets of a session log: strict walk first, magic scan as a fallback.
 * @param {Buffer} buf log bytes.
 * @returns {{offsets: number[], strict: boolean}} offsets and how they were found.
 */
export function frameOffsets(buf) {
  const walked = walkFrameOffsets(buf)
  if (walked !== null && walked.length > 0) return { offsets: walked, strict: true }
  return { offsets: scanFrameOffsets(buf), strict: false }
}

/**
 * Decompress exactly the first frame of a log.
 * @param {Buffer} buf log bytes.
 * @param {number[]} [offsets] known frame offsets.
 * @returns {string} the decompressed header text.
 */
export function decompressHeaderFrame(buf, offsets) {
  const list = offsets ?? frameOffsets(buf).offsets
  const end = list.length > 1 ? list[1] : buf.length
  const slice = buf.subarray(0, end)
  return zlib.zstdDecompressSync(slice).toString('utf8')
}

/**
 * Read a session log's header plus its coarse geometry.
 * @param {Buffer} buf log bytes.
 * @returns {{header: object|null, headerError: string|null, frameCount: number, strict: boolean, offsets: number[]}} parsed header and geometry.
 */
export function readHeader(buf) {
  const geometry = frameOffsets(buf)
  const result = {
    header: null,
    headerError: null,
    frameCount: geometry.offsets.length,
    strict: geometry.strict,
    offsets: geometry.offsets,
  }
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    result.headerError = 'log is empty'
    return result
  }
  if (!hasZstd()) {
    result.headerError = 'this Node build has no zstd support'
    return result
  }
  try {
    const text = decompressHeaderFrame(buf, geometry.offsets)
    const line = text.split('\n', 1)[0]
    const parsed = JSON.parse(line)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('header is not a JSON object')
    result.header = parsed
  } catch (error) {
    result.headerError = error instanceof Error ? error.message : String(error)
  }
  return result
}

/**
 * Replace the header frame of a log, keeping every later byte identical.
 * @param {Buffer} buf original log bytes.
 * @param {object} header the header to write (only `cwd` is meant to change).
 * @returns {{buffer: Buffer, oldFrameBytes: number, newFrameBytes: number, tailBytes: number}} rewritten log.
 * @throws {Error} when the log carries no parsable first frame or zstd is missing.
 */
export function replaceHeaderFrame(buf, header) {
  if (!hasZstd()) throw new Error('this Node build has no zstd support; refusing to rewrite a session header')
  const geometry = frameOffsets(buf)
  if (geometry.offsets.length === 0) throw new Error('session log has no zstd frame')
  const tailStart = geometry.offsets.length > 1 ? geometry.offsets[1] : buf.length
  const tail = buf.subarray(tailStart)
  const frame = Buffer.from(zlib.zstdCompressSync(Buffer.from(JSON.stringify(header) + '\n', 'utf8')))
  return {
    buffer: Buffer.concat([frame, tail]),
    oldFrameBytes: tailStart,
    newFrameBytes: frame.length,
    tailBytes: tail.length,
  }
}

/**
 * Compare the post-header body of two log generations.
 *
 * A frame-count change is normal (a session keeps receiving events after the
 * migration); the evidence of a lossless header rewrite is that everything from
 * frame 2 onward is byte-identical.
 *
 * @param {Buffer} before log bytes captured before the rewrite.
 * @param {Buffer} after log bytes read after the rewrite.
 * @returns {{comparable: boolean, equal: boolean, comparedBytes: number, addedBytes: number, beforeFrames: number, afterFrames: number}} comparison.
 */
export function compareBodies(before, after) {
  const a = frameOffsets(before).offsets
  const b = frameOffsets(after).offsets
  const out = {
    comparable: a.length > 1 && b.length > 1,
    equal: false,
    comparedBytes: 0,
    addedBytes: 0,
    beforeFrames: a.length,
    afterFrames: b.length,
  }
  if (!out.comparable) return out
  const tailA = before.subarray(a[1])
  const tailB = after.subarray(b[1])
  out.comparedBytes = Math.min(tailA.length, tailB.length)
  out.addedBytes = Math.max(0, tailB.length - tailA.length)
  out.equal = out.comparedBytes > 0 && tailA.subarray(0, out.comparedBytes).equals(tailB.subarray(0, out.comparedBytes))
  return out
}

/**
 * End offset of the first frame only.
 * @param {Buffer} buf prefix or whole log.
 * @returns {number} end offset, or -1 when the first frame cannot be parsed.
 */
export function firstFrameEnd(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return -1
  return parseFrameEnd(buf, 0)
}

/**
 * Read a log's header while touching only its first frame.
 * @param {string} logPath absolute log path.
 * @param {typeof import('node:fs')} fs node fs module.
 * @param {number} [maxBytes] prefix size to inspect before falling back to a full read.
 * @returns {{header: object|null, headerError: string|null, sizeBytes: number, frameCount: number|null}} header, size, and (when cheap) frame count.
 */
export function readHeaderFile(logPath, fs, maxBytes = 256 * 1024) {
  const out = { header: null, headerError: null, sizeBytes: 0, frameCount: null }
  let size = 0
  try {
    size = fs.statSync(logPath).size
  } catch (error) {
    out.headerError = error instanceof Error ? error.message : String(error)
    return out
  }
  out.sizeBytes = size
  if (size === 0) {
    out.headerError = 'log is empty'
    return out
  }
  if (!hasZstd()) {
    out.headerError = 'this Node build has no zstd support'
    return out
  }
  let bytes
  try {
    const length = Math.min(size, maxBytes)
    const fd = fs.openSync(logPath, 'r')
    try {
      bytes = Buffer.allocUnsafe(length)
      const read = fs.readSync(fd, bytes, 0, length, 0)
      bytes = bytes.subarray(0, read)
    } finally {
      fs.closeSync(fd)
    }
    let end = firstFrameEnd(bytes)
    if (end < 0 && size > bytes.length) {
      bytes = fs.readFileSync(logPath)
      end = firstFrameEnd(bytes)
    }
    if (end < 0) throw new Error('session log does not start with a parsable zstd frame')
    const text = zlib.zstdDecompressSync(bytes.subarray(0, end)).toString('utf8')
    const parsed = JSON.parse(text.split('\n', 1)[0])
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('header is not a JSON object')
    out.header = parsed
  } catch (error) {
    out.headerError = error instanceof Error ? error.message : String(error)
  }
  return out
}

/**
 * Count zstd frames by scanning chunks, without loading the log into memory.
 * @param {string} logPath absolute log path.
 * @param {typeof import('node:fs')} fs node fs module.
 * @returns {number} frame count.
 */
export function countFramesFile(logPath, fs) {
  const chunk = 4 * 1024 * 1024
  const overlap = ZSTD_MAGIC.length - 1
  let fd
  try {
    fd = fs.openSync(logPath, 'r')
  } catch {
    return 0
  }
  let count = 0
  let carry = Buffer.alloc(0)
  try {
    for (;;) {
      const buffer = Buffer.allocUnsafe(chunk + overlap)
      const read = fs.readSync(fd, buffer, 0, chunk, null)
      if (read <= 0) break
      const merged = carry.length > 0 ? Buffer.concat([carry, buffer.subarray(0, read)]) : buffer.subarray(0, read)
      let at = merged.indexOf(ZSTD_MAGIC)
      while (at !== -1) {
        count += 1
        at = merged.indexOf(ZSTD_MAGIC, at + 1)
      }
      carry = Buffer.from(merged.subarray(Math.max(0, merged.length - overlap)))
      if (read < chunk) break
    }
  } catch {
    // A read failure leaves the count partial; callers treat 0 as unknown.
  } finally {
    try {
      fs.closeSync(fd)
    } catch {
      /* ignore */
    }
  }
  return count
}
