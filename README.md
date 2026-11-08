# DSH Session Migration

> A button in the DeepSeek Harness session header that moves a whole session — log,
> `header.cwd`, and workspace membership — into another working directory, with session
> browsing, one-click backup export, and a workspace health check.

English | [中文](README.zh.md)

![icon](icon.svg)

## Why a tool is needed

A DSH session's workspace membership is decided by **three** things:

| # | Where | What |
|---|---|---|
| ① | `~/.dsh/sessions/<projectKey(cwd)>/<sessionId>/session.v4.jsonl.zstd` | the directory name encodes the working directory |
| ② | the header in **frame 1** of the log | the `cwd` is stored again inside the log |
| ③ | `~/.dsh/storages/workspace.json` → `workspace.sessionIds` | decides which workspace lists it |

Moving the folder by hand trips one of three real crash modes:

- **A** — two copies of one `sessionId` (copy instead of move): the start-up scan conflicts and the session list scrambles.
- **B** — a registry entry pointing at data that is gone: **the whole workspace refuses to open**, and `directoryPickerController` goes unavailable with it.
- **C** — editing `workspace.json` while DSH runs: the in-memory registry overwrites it on exit, so changes are half-applied.

This plugin performs the flow behind one button, and uses only DSH's own services and
(byte-exact) storage conventions: move, never copy; rewrite only frame 1; write the
registry only through the live `workspaceRegistry` Service.

## Features

- **Migrate a session** to an existing workspace or any browsed directory: preflight first, then execute, with an automatic backup, byte-level verification, automatic rollback, and copy-paste rollback commands.
- **Optionally move the source working-directory files** into the target (top-level entries; a name clash is a refusal; the old directory stays as an empty directory so other sessions keep working).
- **Session list**: id, working directory, log size, frame count, last write, current membership, and problem badges.
- **Health check**: dangling references, duplicate ids, header/directory mismatch, empty logs, missing workspace directories, unregistered sessions. Dangling references can be removed safely through the live registry — no shutdown needed.
- **Export a backup**: copy the session directory to a destination of your choice, with a `migration-export.json` manifest, without touching the registry.

## Install

Local directory (best for self-hosting):

```text
plugin_manager install_bundle  target = C:\path\to\dsh-session-migration
```

From GitHub:

```text
plugin_manager install_bundle  target = git+https://github.com/<your-name>/dsh-session-migration.git
```

Or add the row to a profile's `cordis.patch.yml` yourself:

```yaml
- insert:
    - id: session-migration
      name: dsh-session-migration
```

The browser half is picked up automatically from the `dsh.client` declaration.
**If the button does not appear, reload the page once** — a freshly installed client
bundle needs the page to walk the module graph again.

## Usage

1. Open any session; an icon button (two panels, one arrow) appears in the header utilities.
2. Pick the session to migrate in the left column. **The session currently in use cannot migrate itself** — its log is open, so the plugin refuses.
3. Pick a target workspace, or switch to "custom path" and type/browse any directory.
4. Read the preflight: project-key change, target session directory, whether the workspace will be created, and the file-move entry count and clashes.
5. Click “Start migration”, then “Confirm migration”.
6. The result lists each step: backup → data move → header rewrite → verification → file move → workspace membership.

### About “restart required”

The workspace step reports `pending-restart` by design, not as a failure:

> The live workspace registry is a start-up snapshot indexed from session headers; a plugin
> cannot refresh it in place, and writing `workspace.json` by hand while DSH runs is crash
> mode C.

So the membership write goes into a queue
(`~/.dsh/plugin-data/dsh-session-migration/pending.json`) and is applied **on the next DSH
start**, with the outcome logged. Nothing to do manually: restart once and the session
appears under its new workspace. The “Pending” tab can retry it sooner.

## Safety model

| Invariant | How |
|---|---|
| Move, never copy | an existing target session directory is a refusal; the target log size is verified after the move |
| No dangling registry references | the registry is written only through `workspaceRegistry`, and only after the data is in place |
| Only frame 1 changes | decompress frame 1, set `cwd`, recompress frame 1, concatenate the untouched tail |
| Verifiable integrity | compare everything **after frame 1**; a growing frame count (chat continues) is not a failure |
| Idempotent | a repeated move to the same target is a `same-target` no-op, never a second copy |
| Rollback | any failure moves data back, restores the `.bak`, removes a created workspace, and prints copy-paste rollback commands |
| No self-migration | liveness comes from the `agents` Service; a live session is refused |

### Why "decompress, edit, recompress" is wrong

`zlib.zstdDecompressSync(log)` returns **only the first frame** — normally the ~200-byte
header. That looks like “the whole log is one line”, and code that concludes the session is
empty or corrupt can delete real history. This plugin therefore walks RFC 8878
frame/block headers for exact frame boundaries (falling back to a magic-byte scan), counts
frames in chunks without loading an 18 MB log into memory, and replaces frame 1 only.

## Health checks

| code | severity | meaning | auto-fix |
|---|---|---|---|
| `dangling-reference` | error | the registry names a session that is not on disk | ✅ one click |
| `duplicate-session` | error | the same sessionId exists under several project keys | ❌ keep the newer one, back up the other |
| `cwd-mismatch` | error | `header.cwd` disagrees with the project directory | ❌ manual |
| `id-mismatch` | error | directory name ≠ `header.id` | ❌ manual |
| `empty-log` / `missing-log` | error | zero bytes, or no log at all | ❌ manual |
| `missing-workspace-dir` | warn | the workspace directory is gone | ❌ report only |
| `orphan-session` | warn | no workspace accounts for the session (invisible in the UI) | ❌ report only |

> “Small log” is **not** dirty data: an empty session's header is about 300 bytes and is
> perfectly valid.

## Configuration

The row's `config` in `cordis.patch.yml` (defaults shown):

```yaml
- id: session-migration
  name: dsh-session-migration
  config:
    backupBeforeMove: true        # full copy of the session directory before touching it
    keepBackups: 10               # how many automatic backups to retain
    tryImmediateAttach: true      # try to write membership immediately (usually blocked by the index snapshot)
    pendingApplyDelayMs: 2500     # how long after start to apply the queue
    dshHome: ''                   # defaults to $DSH_HOME, then ~/.dsh
    sessionsRoot: ''              # defaults to <dshHome>/sessions
```

Data this plugin owns:

```text
<dshHome>/plugin-data/dsh-session-migration/
  pending.json                 deferred membership writes
  backups/<stamp>-<sessionId>/ pre-migration backups
  exports/<stamp>-<sessionId>/ manual exports
```

## Manual rollback

Every migration prints its own rollback commands; typically (with DSH fully exited):

```powershell
Remove-Item -Recurse -Force "<targetDir>"
Copy-Item -Recurse "<backup>" "<targetDir>"
```

`session.v4.jsonl.zstd.bak` inside the session directory is the pre-rewrite log; DSH never
treats it as a real generation. To undo the membership too, delete the matching entry from
`pending.json`.

## Development

```text
node --check index.js client.js lib/*.js
node --test      # 31 cases: projectKey, frame walking, header rewrite, move & rollback, client contract
```

Layout:

```text
index.js        Host entry: mounts /dsh-session-migration/api, applies the membership queue after start
lib/paths.js    projectKey / encodeSegment / DSH home / path canonicalization (mirrors DSH)
lib/frames.js   zstd frame walking, header read, frame-1 replacement, tail comparison
lib/scan.js     session scan, raw registry read, doctor rules
lib/engine.js   plan / move / verify / rollback / file move / export / pending queue / HTTP dispatch
client.js       browser half: header button + shell.overlay dialog
```

Only Node built-ins are imported, so the package can be published and installed on its own.

## Known limits

- **The open session cannot migrate itself** (its log is held open). That is a guard, not a bug.
- Only frame 1 of a v4 log is rewritten; let DSH finish any cross-version format migration first.
- Moving a whole workspace *directory* is out of scope: a workspace path is fixed by `realpath` at registration, so relocating it makes the old workspace `missing-dir`. The plugin moves **contents** and keeps the source directory.
- Exporting a session that is being written can capture a torn tail; DSH discards a torn tail when reading, and the source is untouched.

## License

MIT. Storage format, `projectKey` rules, and workspace semantics follow the DSH version you
run (`dsh-session-persistence-jsonl`, `dsh-workspace`).
