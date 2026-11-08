/**
 * Path rules shared by the Host half of dsh-session-migration.
 *
 * These reproduce, byte for byte, the conventions DSH itself uses so that a
 * session directory this plugin writes is exactly the directory DSH will read
 * back:
 *
 *   - `projectKey()` / `encodeSegment()` mirror
 *     `@deepseek-ai/dsh-session-persistence-jsonl` (projectDir / sessionDir).
 *   - `resolveDshHome()` mirrors `@deepseek-ai/dsh-home-paths`.
 *   - `canonicalize()` mirrors the workspace registry's `fs.realpath` canon
 *     (`@deepseek-ai/dsh-workspace`), because workspace membership is decided by
 *     string equality of canonical paths.
 *
 * The plugin deliberately depends on node built-ins only: a community bundle is
 * installed into a profile whose node_modules does not resolve DSH's own
 * packages.
 *
 * @module dsh-session-migration/paths
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PLUGIN_ID = 'dsh-session-migration'
export const DSH_HOME_ENV = 'DSH_HOME'
export const SESSION_FORMAT_VERSION = 4

const SAFE_SEGMENT = /^[A-Za-z0-9._-]$/

/**
 * Expand a leading `~` using the current user's home directory.
 * @param {string} value raw path or `~`-prefixed path.
 * @returns {string} expanded path.
 */
export function expandHome(value) {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return value
}

/**
 * Resolve the DSH home directory: explicit config, then `$DSH_HOME`, then `~/.dsh`.
 * @param {string} [configured] explicit path from the plugin config.
 * @returns {string} absolute DSH home.
 */
export function resolveDshHome(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(expandHome(configured.trim()))
  const fromEnv = process.env[DSH_HOME_ENV]
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return path.resolve(expandHome(fromEnv.trim()))
  return path.join(os.homedir(), '.dsh')
}

/**
 * Directory that holds one sub-directory per project key.
 * @param {string} home absolute DSH home.
 * @param {{ sessionsRoot?: string }} [config] optional override.
 * @returns {string} absolute sessions root.
 */
export function resolveSessionsRoot(home, config = {}) {
  if (typeof config.sessionsRoot === 'string' && config.sessionsRoot.trim() !== '') {
    return path.resolve(expandHome(config.sessionsRoot.trim()))
  }
  return path.join(home, 'sessions')
}

/**
 * Directory that holds `workspace.json` and the other storage units.
 * @param {string} home absolute DSH home.
 * @returns {string} absolute storages root.
 */
export function resolveStoragesRoot(home) {
  return path.join(home, 'storages')
}

/**
 * Directory this plugin owns for backups, exports and its migration journal.
 * @param {string} home absolute DSH home.
 * @returns {string} absolute plugin data directory.
 */
export function resolvePluginDataDir(home) {
  return path.join(home, 'plugin-data', PLUGIN_ID)
}

/**
 * Build the readable directory key for a project path.
 *
 * Separators become a single `-`; unsafe code units use the `~XXXX` escape; the
 * key is wrapped in `--` and bounded for filesystem component limits.
 *
 * @param {string} cwd the session's project directory.
 * @returns {string} a single filesystem-safe project directory name.
 */
export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && SAFE_SEGMENT.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * Encode one path segment the way DSH encodes session ids.
 * @param {string} raw raw segment.
 * @returns {string} filesystem-safe segment.
 */
export function encodeSegment(raw) {
  if (typeof raw !== 'string' || raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && SAFE_SEGMENT.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/**
 * Whether a path is absolute in a way DSH accepts as a workspace spelling:
 * on Windows a rooted `C:\...` path, never a `\\`-only or drive-relative path.
 * @param {string} value candidate path.
 * @param {NodeJS.Platform} [platform] host platform.
 * @returns {boolean} true when fully qualified.
 */
export function isFullyQualified(value, platform = process.platform) {
  if (typeof value !== 'string' || value.length === 0) return false
  if (platform !== 'win32') return path.posix.isAbsolute(value)
  const root = path.win32.parse(value).root
  return path.win32.isAbsolute(value) && root !== '\\' && root !== '/'
}

/**
 * Resolve a path through `fs.realpath`, the single uniqueness canon DSH uses for
 * workspace identity.
 * @param {string} value path to canonicalize.
 * @returns {string} canonical path.
 * @throws {Error} when the path does not exist or is not fully qualified.
 */
export function canonicalize(value) {
  if (!isFullyQualified(value)) throw new Error(`path is not fully qualified: '${value}'`)
  const real = fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value)
  const parsed = path.parse(real)
  return real === parsed.root ? real : real.replace(/[\\/]+$/, '')
}

/**
 * Canonicalize a path that may not exist yet, by canonicalizing its nearest
 * existing ancestor and re-appending the missing segments.
 * @param {string} value path that may be missing.
 * @returns {string} canonical-ish path (existing ancestor canonicalized).
 */
export function canonicalizeLoose(value) {
  let current = path.resolve(expandHome(value))
  const missing = []
  for (let guard = 0; guard < 64; guard++) {
    try {
      const real = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current)
      return missing.length === 0 ? real : path.join(real, ...missing.reverse())
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.resolve(expandHome(value))
      missing.push(path.basename(current))
      current = parent
    }
  }
  return path.resolve(expandHome(value))
}

/**
 * Whether a canonical spelling matches on this platform (case-insensitive on Windows).
 * @param {string} a first path.
 * @param {string} b second path.
 * @param {NodeJS.Platform} [platform] host platform.
 * @returns {boolean} true when the two paths name the same location.
 */
export function samePath(a, b, platform = process.platform) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const strip = (v) => (v.length > 1 ? v.replace(/[\\/]+$/, '') : v)
  const left = strip(a)
  const right = strip(b)
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/**
 * Whether `child` is `parent` or lives beneath it (same platform casing rules).
 * @param {string} parent candidate ancestor.
 * @param {string} child candidate descendant.
 * @param {NodeJS.Platform} [platform] host platform.
 * @returns {boolean} true when nested.
 */
export function isInside(parent, child, platform = process.platform) {
  if (typeof parent !== 'string' || typeof child !== 'string') return false
  const normalize = (v) => {
    const resolved = path.resolve(v)
    return platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const base = normalize(parent)
  const target = normalize(child)
  if (base === target) return true
  const withSep = base.endsWith(path.sep) ? base : base + path.sep
  return target.startsWith(withSep)
}

/**
 * Directory that belongs to one session.
 * @param {string} root sessions root.
 * @param {string} cwd session project directory.
 * @param {string} id session id.
 * @returns {string} absolute session directory.
 */
export function sessionDir(root, cwd, id) {
  return path.join(root, projectKey(cwd), encodeSegment(id))
}

/**
 * Current-generation log filename for the session format this build targets.
 * @returns {string} file name.
 */
export function currentLogFilename() {
  return `session.v${SESSION_FORMAT_VERSION}.jsonl.zstd`
}

/**
 * Absolute path of a session's current log.
 * @param {string} root sessions root.
 * @param {string} cwd session project directory.
 * @param {string} id session id.
 * @returns {string} absolute log path.
 */
export function logPath(root, cwd, id) {
  return path.join(sessionDir(root, cwd, id), currentLogFilename())
}

/**
 * Click-friendly shortening of a session id.
 * @param {string} id session id.
 * @returns {string} shortened id.
 */
export function shortId(id) {
  if (typeof id !== 'string') return ''
  return id.length <= 22 ? id : `${id.slice(0, 12)}…${id.slice(-6)}`
}
