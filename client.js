/**
 * dsh-session-migration — browser half.
 *
 * Bundled in the shell module-table format: `window.__ModuleLoader__.load()`
 * with a lazy factory whose id equals the package name (react comes from the
 * browser module table).
 *
 * Two registrations:
 *   - `conversation.session.header.utilities` — the entry button in the session
 *     header.
 *   - `shell.overlay` — the migration dialog, on the frame-wide floating layer
 *     so it is not clipped by the header's own layout.
 *
 * All data comes from the Host half over `/dsh-session-migration/api`; this file
 * never touches the file system.
 *
 * @module dsh-session-migration/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-migration',
  factory(require) {
    // The loader hands the factory only `require`; the CJS-style face is declared
    // here so the kernel can adopt `apply`/`inject` from the returned exports.
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    const API_PATH = '/dsh-session-migration/api'

    // ------------------------------------------------------------------ styles

    const CSS = [
      '.dsm-scope,.dsm-scope *{box-sizing:border-box}',
      '.dsm-icon-btn{width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.dsm-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsm-icon-btn[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsm-icon-btn:focus-visible,.dsm-btn:focus-visible,.dsm-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.dsm-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.34);pointer-events:auto;display:flex;align-items:center;justify-content:center;padding:20px}',
      '.dsm-dialog{width:min(1120px,97vw);height:min(780px,93vh);display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 20px 56px rgba(0,0,0,.32);font-size:13px;line-height:1.5}',
      '.dsm-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}',
      '.dsm-title{font-size:14px;font-weight:600;letter-spacing:.2px}',
      '.dsm-sub{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.dsm-spacer{flex:1 1 auto}',
      '.dsm-tabs{display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:0 0 auto}',
      '.dsm-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12.5px}',
      '.dsm-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsm-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dsm-body{flex:1 1 auto;display:flex;min-height:0}',
      '.dsm-col{display:flex;flex-direction:column;min-height:0;min-width:0}',
      '.dsm-col-left{width:390px;flex:0 0 390px;border-right:1px solid var(--dsw-alias-border-l1)}',
      '.dsm-col-right{flex:1 1 auto;overflow-y:auto;padding:14px 16px 20px}',
      '.dsm-toolbar{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center}',
      '.dsm-list{overflow-y:auto;flex:1 1 auto;padding:6px}',
      '.dsm-row{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:9px;cursor:pointer;border:1px solid transparent}',
      '.dsm-row:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsm-row[data-sel="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.dsm-row-top{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dsm-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px}',
      '.dsm-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
      '.dsm-meta{color:var(--dsw-alias-label-secondary);font-size:11.5px;display:flex;gap:6px;flex-wrap:wrap}',
      '.dsm-badge{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:9px;font-size:11px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsm-badge[data-kind="current"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.dsm-badge[data-kind="live"]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.dsm-badge[data-kind="error"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.dsm-badge[data-kind="ok"]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.dsm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px;white-space:nowrap}',
      '.dsm-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsm-btn:disabled{opacity:.45;cursor:not-allowed;background:transparent}',
      '.dsm-btn[data-variant="primary"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.dsm-btn[data-variant="primary"]:hover{filter:brightness(1.06);background:var(--dsw-alias-brand-primary)}',
      '.dsm-btn[data-variant="danger"]{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
      '.dsm-btn[data-variant="danger"]:hover{background:var(--dsw-alias-state-error-primary);color:#fff}',
      '.dsm-input,select.dsm-input,textarea.dsm-input{width:100%;height:30px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12.5px;font-family:inherit}',
      'textarea.dsm-input{height:auto;padding:7px 9px;resize:vertical}',
      '.dsm-input:disabled{opacity:.6}',
      '.dsm-section{margin-bottom:16px}',
      '.dsm-label{font-size:12px;font-weight:600;margin-bottom:6px;color:var(--dsw-alias-label-primary)}',
      '.dsm-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsm-kv{display:grid;grid-template-columns:112px 1fr;gap:4px 10px;font-size:12px;align-items:start}',
      '.dsm-kv dt{color:var(--dsw-alias-label-secondary)}',
      '.dsm-kv dd{margin:0;word-break:break-all;min-width:0}',
      '.dsm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2)}',
      '.dsm-check{display:flex;gap:8px;align-items:flex-start;font-size:12px;padding:4px 0;cursor:pointer}',
      '.dsm-check input{margin-top:2px;accent-color:var(--dsw-alias-brand-primary)}',
      '.dsm-alert{border-radius:9px;padding:8px 10px;font-size:12px;border:1px solid var(--dsw-alias-border-l2);margin:8px 0;word-break:break-word}',
      '.dsm-alert[data-kind="error"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.dsm-alert[data-kind="warn"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}',
      '.dsm-alert[data-kind="ok"]{border-color:var(--dsw-alias-state-success-primary)}',
      '.dsm-steps{display:flex;flex-direction:column;gap:5px;font-size:12px}',
      '.dsm-step{display:flex;gap:8px;align-items:baseline}',
      '.dsm-step-name{min-width:106px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px}',
      '.dsm-step[data-status="failed"] .dsm-step-detail{color:var(--dsw-alias-state-error-primary)}',
      '.dsm-step[data-status="skipped"] .dsm-step-detail,.dsm-step[data-status="deferred"] .dsm-step-detail{color:var(--dsw-alias-state-warn-primary)}',
      '.dsm-pre{margin:8px 0 0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;max-height:150px;overflow:auto}',
      '.dsm-issue{display:flex;gap:8px;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);margin-bottom:6px;align-items:flex-start}',
      '.dsm-issue[data-sev="error"]{border-color:var(--dsw-alias-state-error-primary)}',
      '.dsm-issue[data-sev="warn"]{border-color:var(--dsw-alias-state-warn-primary)}',
      '.dsm-issue-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsm-foot{flex:0 0 auto;border-top:1px solid var(--dsw-alias-border-l1);padding:8px 14px;display:flex;gap:10px;align-items:center;font-size:11.5px;color:var(--dsw-alias-label-secondary)}',
      '.dsm-empty{padding:18px;color:var(--dsw-alias-label-secondary);text-align:center;font-size:12px}',
      '.dsm-chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.dsm-chip{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:transparent;color:var(--dsw-alias-label-secondary);padding:2px 8px;font-size:11.5px;cursor:pointer;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsm-chip:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dsm-chip[data-active="true"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.dsm-copy{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;padding:0 4px}',
      '.dsm-copy:hover{color:var(--dsw-alias-brand-primary)}',
      '.dsm-dest-row{display:flex;gap:8px;align-items:center;margin-top:6px}',
      '.dsm-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}',
      '.dsm-seg button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:4px 10px;font-size:12px;cursor:pointer}',
      '.dsm-seg button[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
    ].join('\n')

    // ------------------------------------------------------------------- i18n

    const DICT = {
      zh: {
        'button.title': '会话迁移 / 工作区工具',
        'title': '会话迁移',
        'subtitle': '搬动整段会话（日志 + header.cwd + 工作区归属）',
        tabMigrate: '迁移',
        tabDoctor: '体检',
        tabPending: '待补写',
        refresh: '刷新',
        close: '关闭',
        search: '搜索 id / 路径',
        sessions: '会话',
        workspaces: '工作区',
        selectOne: '从左侧选择一个会话',
        current: '当前',
        live: '使用中',
        duplicate: '重复',
        issues: '问题',
        noSessions: '没有找到会话',
        selected: '选中的会话',
        id: '会话 id',
        cwd: '工作目录',
        size: '日志大小',
        frames: '帧数',
        mtime: '最后写入',
        membership: '当前归属',
        noWorkspace: '未登记',
        agentPreset: '智能体预设',
        destination: '目标工作区',
        pickExisting: '已有工作区',
        pickCustom: '自定义路径',
        browse: '浏览…',
        pathPlaceholder: '例如 C:\\Agent-Project\\new-work',
        createTargetDir: '目标目录不存在时自动创建',
        moveFiles: '同时搬运源工作目录中的文件到目标目录',
        moveFilesHint: '只搬顶层条目，遇到同名条目会拒绝。原目录保留（变空），不会破坏其它会话。',
        allowSharedSource: '仍然搬运（源目录还有其它会话，会破坏它们）',
        preview: '预检',
        previewing: '预检中…',
        planFrom: '从',
        planTo: '到',
        planTargetDir: '目标会话目录',
        planKeyChange: '项目目录键',
        planWorkspace: '目标工作区',
        planWillCreate: '将新建',
        planFiles: '文件搬运',
        planFilesSummary: '个顶层条目',
        start: '开始迁移',
        confirm: '确认迁移',
        working: '执行中…',
        cancel: '取消',
        result: '结果',
        verify: '完整性校验',
        accounting: '工作区归属',
        restart: '需要重启 DSH 以刷新工作区索引',
        restartDetail: '运行中的工作区索引是启动时的快照；归属已写入队列，下次启动时自动补写。',
        rollbackCmd: '回滚命令',
        export: '导出备份',
        exporting: '导出中…',
        exported: '已导出到',
        doctorRun: '运行体检',
        doctorRunning: '体检中…',
        doctorSummary: '共 {sessions} 个会话 / {workspaces} 个工作区：{errors} 个错误，{warnings} 个警告',
        doctorClean: '没有发现问题。',
        repair: '修复悬空引用',
        repairing: '修复中…',
        repairDone: '已摘除 {count} 条悬空引用',
        pendingEmpty: '没有待补写的记录。',
        pendingApply: '立即补写',
        pendingApplying: '补写中…',
        pendingHint: '每次启动 DSH 后本插件会自动尝试补写；这里可以手动重试。',
        applied: '已补写',
        remaining: '仍失败',
        lastError: '最近错误',
        attempts: '尝试次数',
        reload: '重新加载',
        copied: '已复制',
        unknownError: '未知错误',
        liveRefuse: '该会话正在使用中，无法自迁。请先打开别的会话，或重启 DSH 后再试。',
        noTarget: '请选择目标工作区',
        planBlocked: '预检未通过',
        filesBlocked: '文件搬运前置检查未通过',
        loading: '加载中…',
        backend: 'Host 接口',
      },
      en: {
        'button.title': 'Session migration / workspace tools',
        'title': 'Session migration',
        'subtitle': 'Move a whole session: log, header.cwd and workspace membership',
        tabMigrate: 'Migrate',
        tabDoctor: 'Health',
        tabPending: 'Pending',
        refresh: 'Refresh',
        close: 'Close',
        search: 'Filter by id / path',
        sessions: 'sessions',
        workspaces: 'workspaces',
        selectOne: 'Select a session on the left',
        current: 'current',
        live: 'in use',
        duplicate: 'duplicate',
        issues: 'issues',
        noSessions: 'No session found',
        selected: 'Selected session',
        id: 'Session id',
        cwd: 'Working directory',
        size: 'Log size',
        frames: 'Frames',
        mtime: 'Last write',
        membership: 'Membership',
        noWorkspace: 'unregistered',
        agentPreset: 'Agent preset',
        destination: 'Target workspace',
        pickExisting: 'Existing workspace',
        pickCustom: 'Custom path',
        browse: 'Browse…',
        pathPlaceholder: 'e.g. C:\\Agent-Project\\new-work',
        createTargetDir: 'Create the target directory when missing',
        moveFiles: 'Also move the source working-directory files into the target',
        moveFilesHint: 'Top-level entries only; a name clash is a refusal. The old directory stays (empty) so other sessions keep working.',
        allowSharedSource: 'Move anyway (other sessions still use the source directory)',
        preview: 'Preflight',
        previewing: 'Checking…',
        planFrom: 'From',
        planTo: 'To',
        planTargetDir: 'Target session directory',
        planKeyChange: 'Project key',
        planWorkspace: 'Target workspace',
        planWillCreate: 'will be created',
        planFiles: 'File move',
        planFilesSummary: 'top-level entries',
        start: 'Start migration',
        confirm: 'Confirm migration',
        working: 'Working…',
        cancel: 'Cancel',
        result: 'Result',
        verify: 'Integrity check',
        accounting: 'Workspace membership',
        restart: 'Restart DSH to refresh the workspace index',
        restartDetail: 'The live workspace index is a start-up snapshot. The membership write is queued and applied on the next start.',
        rollbackCmd: 'Rollback commands',
        export: 'Export backup',
        exporting: 'Exporting…',
        exported: 'Exported to',
        doctorRun: 'Run check',
        doctorRunning: 'Checking…',
        doctorSummary: '{sessions} sessions / {workspaces} workspaces: {errors} errors, {warnings} warnings',
        doctorClean: 'No problem found.',
        repair: 'Drop dangling references',
        repairing: 'Repairing…',
        repairDone: 'Removed {count} dangling reference(s)',
        pendingEmpty: 'Nothing pending.',
        pendingApply: 'Apply now',
        pendingApplying: 'Applying…',
        pendingHint: 'This plugin retries automatically on every start; you can also retry here.',
        applied: 'Applied',
        remaining: 'Still failing',
        lastError: 'Last error',
        attempts: 'Attempts',
        reload: 'Reload',
        copied: 'Copied',
        unknownError: 'Unknown error',
        liveRefuse: 'This session is in use, so it cannot migrate itself. Open another session or restart DSH first.',
        noTarget: 'Choose a target workspace',
        planBlocked: 'Preflight failed',
        filesBlocked: 'The file-move preflight failed',
        loading: 'Loading…',
        backend: 'Host API',
      },
    }

    /**
     * Build a translate function bound to the Client locale service.
     * @param {object} ctx plugin context.
     * @returns {(key: string, vars?: object) => string} translate.
     */
    function makeTranslator(ctx) {
      const localeService = safeGet(ctx, 'locale')
      const pick = () => {
        try {
          const snapshot = localeService?.getLocale?.() ?? localeService?.getSnapshot?.()
          const id = snapshot?.id ?? snapshot?.locale ?? snapshot?.active?.id
          return typeof id === 'string' && id.toLowerCase().startsWith('en') ? 'en' : 'zh'
        } catch {
          return 'zh'
        }
      }
      return (key, vars) => {
        const table = DICT[pick()] ?? DICT.zh
        let text = table[key] ?? DICT.zh[key] ?? key
        if (vars !== undefined) {
          for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value))
        }
        return text
      }
    }

    /**
     * Read one optional service.
     * @param {object} ctx plugin context.
     * @param {string} key service name.
     * @returns {any} the service, or undefined.
     */
    function safeGet(ctx, key) {
      try {
        return ctx.get(key)
      } catch {
        return undefined
      }
    }

    // ------------------------------------------------------------------ store

    /**
     * Tiny external store for "dialog open + seed session", shared by the header
     * button and the overlay dialog.
     * @returns {object} store.
     */
    function createStore() {
      let state = { open: false, seed: null }
      const listeners = new Set()
      return {
        get: () => state,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        open(seed) {
          state = { open: true, seed: typeof seed === 'string' ? seed : null }
          for (const listener of listeners) listener()
        },
        close() {
          state = { open: false, seed: null }
          for (const listener of listeners) listener()
        },
      }
    }

    /**
     * Subscribe a component to the store.
     * @param {object} store store from {@link createStore}.
     * @returns {{open: boolean, seed: string|null}} current state.
     */
    function useStore(store) {
      return React.useSyncExternalStore(store.subscribe, store.get, store.get)
    }

    // -------------------------------------------------------------------- api

    /**
     * Call the Host API.
     * @param {string} action action name.
     * @param {object} [payload] extra request fields.
     * @returns {Promise<object>} response payload.
     */
    async function callApi(action, payload = {}) {
      const response = await fetch(API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
        cache: 'no-store',
      })
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (data !== null && data.ok === true) return data
      const error = new Error(data?.error?.message ?? `HTTP ${response.status}`)
      error.code = data?.error?.code
      error.details = data?.error?.details
      throw error
    }

    // -------------------------------------------------------------- formatting

    const pad2 = (value) => String(value).padStart(2, '0')

    /**
     * @param {number|null} bytes byte count.
     * @returns {string} readable size.
     */
    function fmtBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—'
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    }

    /**
     * @param {number|null} ms epoch milliseconds.
     * @returns {string} local timestamp.
     */
    function fmtTime(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
      const d = new Date(ms)
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    }

    /**
     * @param {string|null} id session id.
     * @returns {string} shortened id.
     */
    function fmtId(id) {
      if (typeof id !== 'string') return ''
      return id.length <= 24 ? id : `${id.slice(0, 13)}…${id.slice(-6)}`
    }

    /**
     * @param {number|null} value number.
     * @returns {string} grouped number or an em dash.
     */
    function fmtNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : '—'
    }

    /**
     * Copy text to the clipboard.
     * @param {string} text text to copy.
     */
    function copyText(text) {
      try {
        navigator.clipboard?.writeText?.(String(text))
      } catch {
        /* clipboard may be unavailable */
      }
    }

    // ------------------------------------------------------------------- icons

    /** Entry icon: two panels with an arrow between them. */
    function Icon() {
      return h(
        'svg',
        { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 6.5, height: 16, rx: 1.6, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('rect', { x: 14.5, y: 4, width: 6.5, height: 16, rx: 1.6, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M10.6 12h3', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M13.9 10.2 15.7 12l-1.8 1.8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /** Small warning triangle. */
    function IconWarn() {
      return h(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { flex: '0 0 auto', marginTop: 2 } },
        h('path', { d: 'M12 4.5 21 19.5H3L12 4.5Z', stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round' }),
        h('path', { d: 'M12 10v4.2', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('circle', { cx: 12, cy: 17, r: 0.9, fill: 'currentColor' }),
      )
    }

    /** Stylesheet rendered as a React element so unmounting removes it. */
    function StyleTag() {
      return h('style', null, CSS)
    }

    // ------------------------------------------------------------------ pieces

    /**
     * Small button.
     * @param {object} props component props.
     * @returns {object} element.
     */
    function Button({ variant, onClick, disabled, children, title, type }) {
      return h(
        'button',
        {
          className: 'dsm-btn',
          type: type ?? 'button',
          'data-variant': variant,
          onClick,
          disabled: disabled === true,
          title,
        },
        children,
      )
    }

    /**
     * Badge chip.
     * @param {object} props component props.
     * @returns {object} element.
     */
    function Badge({ kind, children }) {
      return h('span', { className: 'dsm-badge', 'data-kind': kind }, children)
    }

    /**
     * Checkbox row.
     * @param {object} props component props.
     * @returns {object} element.
     */
    function Check({ checked, onChange, disabled, children }) {
      return h(
        'label',
        { className: 'dsm-check' },
        h('input', { type: 'checkbox', checked: checked === true, disabled: disabled === true, onChange: (event) => onChange?.(event.target.checked) }),
        h('span', null, children),
      )
    }

    /**
     * Copyable value.
     * @param {object} props component props.
     * @returns {object} element.
     */
    function Copyable({ text, t, mono }) {
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'baseline', gap: 2, minWidth: 0 } },
        h('span', { className: mono === false ? 'dsm-ellipsis' : 'dsm-mono dsm-ellipsis', title: text }, text),
        h(
          'button',
          { className: 'dsm-copy', type: 'button', title: t('copied'), onClick: () => copyText(text) },
          '⧉',
        ),
      )
    }

    // --------------------------------------------------------------- header button

    /**
     * Session-header entry point.
     * @param {object} props `{ store, t, sessionId }`.
     * @returns {object} element.
     */
    function HeaderButton({ store, t, sessionId }) {
      const state = useStore(store)
      return h(
        React.Fragment,
        null,
        h(StyleTag),
        h(
          'button',
          {
            className: 'dsm-icon-btn',
            type: 'button',
            title: t('button.title'),
            'aria-label': t('button.title'),
            'aria-expanded': state.open ? 'true' : 'false',
            'data-active': state.open ? 'true' : 'false',
            onClick: () => (state.open ? store.close() : store.open(sessionId)),
          },
          h(Icon),
        ),
      )
    }

    // ------------------------------------------------------------------- dialog

    /**
     * Overlay host: renders the dialog only while it is open.
     * @param {object} props `{ store, t, api }`.
     * @returns {object|null} element.
     */
    function PanelHost({ store, t, api }) {
      const state = useStore(store)
      if (!state.open) return null
      return h(Panel, { store, t, api, seed: state.seed })
    }

    /**
     * The migration dialog.
     * @param {object} props `{ store, t, api, seed }`.
     * @returns {object} element.
     */
    function Panel({ store, t, api, seed }) {
      const [tab, setTab] = React.useState('migrate')
      const [snapshot, setSnapshot] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [selectedId, setSelectedId] = React.useState(seed)
      const [filter, setFilter] = React.useState('')
      const [dest, setDest] = React.useState('')
      const [customMode, setCustomMode] = React.useState(false)
      const [moveFiles, setMoveFiles] = React.useState(false)
      const [allowSharedSource, setAllowSharedSource] = React.useState(false)
      const [createTargetDir, setCreateTargetDir] = React.useState(false)
      const [plan, setPlan] = React.useState(null)
      const [planError, setPlanError] = React.useState(null)
      const [planning, setPlanning] = React.useState(false)
      const [armed, setArmed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [doctor, setDoctor] = React.useState(null)
      const [doctorBusy, setDoctorBusy] = React.useState(false)
      const [repairInfo, setRepairInfo] = React.useState(null)
      const [pending, setPending] = React.useState(null)
      const [pendingBusy, setPendingBusy] = React.useState(false)
      const [exportInfo, setExportInfo] = React.useState(null)

      const load = React.useCallback(async () => {
        setLoading(true)
        try {
          const data = await callApi('snapshot')
          setSnapshot(data)
          setError(null)
          setPending({ entries: data.pending ?? [], lastApply: data.pendingApply ?? null })
          return data
        } catch (loadError) {
          setError(loadError.message)
          return null
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') store.close()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [store])

      const sessions = snapshot?.sessions ?? []
      const workspaces = snapshot?.workspaces ?? []
      const selected = React.useMemo(() => sessions.find((session) => session.id === selectedId) ?? null, [sessions, selectedId])

      // Default selection: the seeded session when it can migrate, otherwise the
      // newest session that is not the one currently in use.
      React.useEffect(() => {
        if (snapshot === null) return
        if (selectedId !== null && sessions.some((session) => session.id === selectedId)) return
        const preferred =
          sessions.find((session) => session.id === seed && session.live !== true) ??
          sessions.find((session) => session.live !== true) ??
          sessions[0] ??
          null
        setSelectedId(preferred?.id ?? null)
      }, [snapshot, seed, selectedId, sessions])

      // Destination default: a workspace other than the session's current cwd.
      React.useEffect(() => {
        if (selected === null) return
        if (customMode && dest !== '') return
        if (dest !== '' && !workspaces.some((workspace) => workspace.path === dest)) return
        const other = workspaces.find((workspace) => workspace.path !== selected.cwd)
        setDest(other?.path ?? '')
        setCustomMode(other === undefined)
      }, [selected, workspaces, dest, customMode])

      // Debounced preflight.
      React.useEffect(() => {
        setArmed(false)
        if (selected === null || dest === '') {
          setPlan(null)
          setPlanError(null)
          return undefined
        }
        let cancelled = false
        setPlanning(true)
        const timer = setTimeout(() => {
          callApi('plan', { sessionId: selected.id, toPath: dest, moveFiles, createTargetDir, allowSharedSource })
            .then((data) => {
              if (cancelled) return
              setPlan(data)
              setPlanError(null)
            })
            .catch((planFailure) => {
              if (cancelled) return
              setPlan(null)
              setPlanError({ message: planFailure.message, code: planFailure.code, details: planFailure.details })
            })
            .finally(() => {
              if (!cancelled) setPlanning(false)
            })
        }, 350)
        return () => {
          cancelled = true
          clearTimeout(timer)
          setPlanning(false)
        }
      }, [selected, dest, moveFiles, createTargetDir, allowSharedSource, snapshot])

      const runMove = async () => {
        if (selected === null) return
        if (armed !== true) {
          setArmed(true)
          return
        }
        setBusy(true)
        setResult(null)
        setExportInfo(null)
        try {
          const data = await callApi('move', { sessionId: selected.id, toPath: dest, moveFiles, createTargetDir, allowSharedSource })
          setResult({ ok: true, data })
          await load()
        } catch (moveError) {
          setResult({ ok: false, error: moveError })
          await load()
        } finally {
          setBusy(false)
          setArmed(false)
        }
      }

      const runExport = async () => {
        if (selected === null) return
        setBusy(true)
        try {
          const data = await callApi('export', { sessionId: selected.id })
          setExportInfo({ ok: true, path: data.path, bytes: data.bytes })
        } catch (exportError) {
          setExportInfo({ ok: false, message: exportError.message })
        } finally {
          setBusy(false)
        }
      }

      const runDoctor = async () => {
        setDoctorBusy(true)
        try {
          const data = await callApi('doctor')
          setDoctor(data)
          setRepairInfo(null)
        } catch (doctorError) {
          setDoctor({ ok: false, error: doctorError.message })
        } finally {
          setDoctorBusy(false)
        }
      }

      const runRepair = async () => {
        setDoctorBusy(true)
        try {
          const data = await callApi('repair')
          setRepairInfo(data)
          const refreshed = await callApi('doctor')
          setDoctor(refreshed)
        } catch (repairError) {
          setRepairInfo({ ok: false, error: repairError.message })
        } finally {
          setDoctorBusy(false)
        }
      }

      const runApplyPending = async () => {
        setPendingBusy(true)
        try {
          const data = await callApi('applyPending')
          setPending({ entries: data.pending ?? [], lastApply: { applied: data.applied, remaining: data.remaining } })
          await load()
        } catch (pendingError) {
          setPending({ entries: [], lastApply: null, error: pendingError.message })
        } finally {
          setPendingBusy(false)
        }
      }

      const filtered = sessions.filter((session) => {
        if (filter.trim() === '') return true
        const needle = filter.trim().toLowerCase()
        return (
          session.id.toLowerCase().includes(needle) ||
          (session.cwd ?? '').toLowerCase().includes(needle) ||
          (session.workspaceTitles ?? []).join(' ').toLowerCase().includes(needle)
        )
      })

      const pick = async () => {
        try {
          const value = await api?.pickDirectory?.()
          if (typeof value === 'string' && value !== '') {
            setCustomMode(true)
            setDest(value)
          }
        } catch (pickError) {
          setError(pickError instanceof Error ? pickError.message : String(pickError))
        }
      }

      const pendingCount = pending?.entries?.length ?? 0
      const canMove = plan !== null && planError === null && selected !== null && selected.live !== true && busy !== true

      return h(
        'div',
        { className: 'dsm-scope' },
        h(StyleTag),
        h(
          'div',
          { className: 'dsm-backdrop', onMouseDown: (event) => { if (event.target === event.currentTarget) store.close() } },
          h(
            'div',
            { className: 'dsm-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('title') },
            h(
              'div',
              { className: 'dsm-head' },
              h(Icon),
              h('div', null, h('div', { className: 'dsm-title' }, t('title')), h('div', { className: 'dsm-sub' }, t('subtitle'))),
              h('div', { className: 'dsm-spacer' }),
              snapshot !== null ? h('span', { className: 'dsm-sub' }, `${sessions.length} ${t('sessions')} · ${workspaces.length} ${t('workspaces')}`) : null,
              h(Button, { onClick: () => load(), disabled: loading }, t('refresh')),
              h('button', { className: 'dsm-icon-btn', type: 'button', title: t('close'), 'aria-label': t('close'), onClick: () => store.close() }, '✕'),
            ),
            h(
              'div',
              { className: 'dsm-tabs' },
              h('button', { className: 'dsm-tab', type: 'button', 'data-active': tab === 'migrate' ? 'true' : 'false', onClick: () => setTab('migrate') }, t('tabMigrate')),
              h('button', { className: 'dsm-tab', type: 'button', 'data-active': tab === 'doctor' ? 'true' : 'false', onClick: () => { setTab('doctor'); if (doctor === null) runDoctor() } }, t('tabDoctor')),
              h(
                'button',
                { className: 'dsm-tab', type: 'button', 'data-active': tab === 'pending' ? 'true' : 'false', onClick: () => setTab('pending') },
                `${t('tabPending')}${pendingCount > 0 ? ` (${pendingCount})` : ''}`,
              ),
            ),
            error !== null ? h('div', { className: 'dsm-alert', 'data-kind': 'error' }, error) : null,
            tab === 'migrate'
              ? h(
                  'div',
                  { className: 'dsm-body' },
                  h(
                    'div',
                    { className: 'dsm-col dsm-col-left' },
                    h(
                      'div',
                      { className: 'dsm-toolbar' },
                      h('input', {
                        className: 'dsm-input',
                        placeholder: t('search'),
                        value: filter,
                        onChange: (event) => setFilter(event.target.value),
                      }),
                    ),
                    loading && sessions.length === 0
                      ? h('div', { className: 'dsm-empty' }, t('loading'))
                      : filtered.length === 0
                        ? h('div', { className: 'dsm-empty' }, t('noSessions'))
                        : h(
                            'div',
                            { className: 'dsm-list' },
                            filtered.map((session) =>
                              h(
                                'div',
                                {
                                  key: session.id,
                                  className: 'dsm-row',
                                  'data-sel': session.id === selectedId ? 'true' : 'false',
                                  onClick: () => setSelectedId(session.id),
                                },
                                h(
                                  'div',
                                  { className: 'dsm-row-top' },
                                  h('span', { className: 'dsm-mono dsm-ellipsis' }, fmtId(session.id)),
                                  h('span', { className: 'dsm-spacer' }),
                                  session.id === seedId(store) ? h(Badge, { kind: 'current' }, t('current')) : null,
                                  session.live === true ? h(Badge, { kind: 'live' }, t('live')) : null,
                                  session.duplicate === true ? h(Badge, { kind: 'error' }, t('duplicate')) : null,
                                  (session.issues ?? []).some((issue) => issue.severity === 'error')
                                    ? h(Badge, { kind: 'error' }, t('issues'))
                                    : null,
                                ),
                                h('div', { className: 'dsm-meta' }, h('span', { className: 'dsm-ellipsis', title: session.cwd ?? '' }, session.cwd ?? '—')),
                                h(
                                  'div',
                                  { className: 'dsm-meta' },
                                  h('span', null, fmtBytes(session.sizeBytes)),
                                  h('span', null, `· ${fmtNumber(session.frames)} ${t('frames')}`),
                                  h('span', null, `· ${fmtTime(session.mtime)}`),
                                  h('span', { className: 'dsm-ellipsis' }, `· ${(session.workspaceTitles ?? []).join(', ') || t('noWorkspace')}`),
                                ),
                              ),
                            ),
                          ),
                  ),
                  h(
                    'div',
                    { className: 'dsm-col dsm-col-right' },
                    selected === null
                      ? h('div', { className: 'dsm-empty' }, t('selectOne'))
                      : h(
                          React.Fragment,
                          null,
                          h(SessionDetail, { session: selected, t }),
                          h(MigrateForm, {
                            t, api, selected, workspaces, dest, setDest, customMode, setCustomMode, pick,
                            moveFiles, setMoveFiles, allowSharedSource, setAllowSharedSource,
                            createTargetDir, setCreateTargetDir, plan, planError, planning,
                            canMove, armed, busy, result, onRun: runMove,
                            exportInfo, onExport: runExport,
                          }),
                        ),
                  ),
                )
              : null,
            tab === 'doctor'
              ? h(DoctorPane, { t, doctor, busy: doctorBusy, onRun: runDoctor, onRepair: runRepair, repairInfo })
              : null,
            tab === 'pending' ? h(PendingPane, { t, pending, busy: pendingBusy, onApply: runApplyPending }) : null,
            h(
              'div',
              { className: 'dsm-foot' },
              h('span', { className: 'dsm-ellipsis' }, `${t('backend')}: ${snapshot?.sessionsRoot ?? '…'}`),
              h('span', { className: 'dsm-spacer' }),
              snapshot !== null && snapshot.zstd === false ? h(Badge, { kind: 'error' }, 'zstd unavailable') : null,
            ),
          ),
        ),
      )
    }

    /**
     * @param {object} store store.
     * @returns {string|null} the session id the dialog was opened from.
     */
    function seedId(store) {
      const state = store.get()
      return state.open ? state.seed : null
    }

    /**
     * Selected-session summary.
     * @param {object} props `{ session, t }`.
     * @returns {object} element.
     */
    function SessionDetail({ session, t }) {
      return h(
        'div',
        { className: 'dsm-section' },
        h('div', { className: 'dsm-label' }, t('selected')),
        h(
          'div',
          { className: 'dsm-card' },
          h(
            'dl',
            { className: 'dsm-kv' },
            h('dt', null, t('id')),
            h('dd', null, h(Copyable, { text: session.id, t })),
            h('dt', null, t('cwd')),
            h('dd', null, h(Copyable, { text: session.cwd ?? '—', t })),
            h('dt', null, t('size')),
            h('dd', null, `${fmtBytes(session.sizeBytes)} · ${fmtNumber(session.frames)} ${t('frames')}`),
            h('dt', null, t('mtime')),
            h('dd', null, fmtTime(session.mtime)),
            h('dt', null, t('membership')),
            h(
              'dd',
              null,
              (session.workspaceTitles ?? []).length === 0
                ? t('noWorkspace')
                : (session.workspaceTitles ?? []).join(', '),
            ),
            session.agentPreset !== null && session.agentPreset !== undefined
              ? h(React.Fragment, null, h('dt', null, t('agentPreset')), h('dd', null, String(session.agentPreset)))
              : null,
          ),
          (session.issues ?? []).length > 0
            ? h(
                'div',
                { style: { marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' } },
                (session.issues ?? []).map((issue, index) =>
                  h(Badge, { key: `${issue.code}-${index}`, kind: issue.severity === 'error' ? 'error' : undefined }, issue.code),
                ),
              )
            : null,
        ),
        session.live === true ? h('div', { className: 'dsm-alert', 'data-kind': 'warn' }, t('liveRefuse')) : null,
      )
    }

    /**
     * Destination picker, preflight preview, action button and result.
     * @param {object} props component props.
     * @returns {object} element.
     */
    function MigrateForm(props) {
      const {
        t, api, selected, workspaces, dest, setDest, customMode, setCustomMode, pick,
        moveFiles, setMoveFiles, allowSharedSource, setAllowSharedSource, createTargetDir, setCreateTargetDir,
        plan, planError, planning, canMove, armed, busy, result, onRun, exportInfo, onExport,
      } = props

      const blockers = plan?.files?.blockers ?? []
      const showSharedConfirm = moveFiles && blockers.length > 0

      return h(
        'div',
        { className: 'dsm-section' },
        h('div', { className: 'dsm-label' }, t('destination')),
        h(
          'div',
          { className: 'dsm-seg', style: { marginBottom: 6 } },
          h('button', { type: 'button', 'data-active': customMode === false ? 'true' : 'false', onClick: () => setCustomMode(false) }, t('pickExisting')),
          h('button', { type: 'button', 'data-active': customMode === true ? 'true' : 'false', onClick: () => setCustomMode(true) }, t('pickCustom')),
        ),
        customMode === false
          ? h(
              'select',
              { className: 'dsm-input', value: dest, onChange: (event) => setDest(event.target.value) },
              h('option', { value: '' }, '—'),
              workspaces
                .filter((workspace) => workspace.path !== selected.cwd)
                .map((workspace) => h('option', { key: workspace.id, value: workspace.path }, `${workspace.title || workspace.path} — ${workspace.path}`)),
            )
          : h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'dsm-dest-row' },
                h('input', { className: 'dsm-input', placeholder: t('pathPlaceholder'), value: dest, onChange: (event) => setDest(event.target.value) }),
                api?.pickDirectory
                  ? h(Button, { onClick: pick }, t('browse'))
                  : null,
              ),
              h(Check, { checked: createTargetDir, onChange: setCreateTargetDir }, t('createTargetDir')),
            ),
        h(
          'div',
          { style: { marginTop: 10 } },
          h(Check, { checked: moveFiles, onChange: setMoveFiles }, t('moveFiles')),
          h('div', { className: 'dsm-hint', style: { marginLeft: 22 } }, t('moveFilesHint')),
          showSharedConfirm
            ? h(
                'div',
                { style: { marginLeft: 22 } },
                h(
                  'div',
                  { className: 'dsm-alert', 'data-kind': 'warn' },
                  `${blockers.length} ${t('sessions')}: ${blockers.map((item) => fmtId(item.id)).join(', ')}`,
                ),
                h(Check, { checked: allowSharedSource, onChange: setAllowSharedSource }, t('allowSharedSource')),
              )
            : null,
        ),
        h(
          'div',
          { style: { marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' } },
          h(
            Button,
            { variant: 'primary', onClick: onRun, disabled: !canMove },
            busy ? t('working') : armed ? t('confirm') : t('start'),
          ),
          h(Button, { onClick: onExport, disabled: busy || selected.live === true }, exportInfo?.ok ? t('exported') : t('export')),
          h('span', { className: 'dsm-spacer' }),
          planning ? h('span', { className: 'dsm-hint' }, t('previewing')) : null,
        ),
        exportInfo !== null
          ? h(
              'div',
              { className: 'dsm-alert', 'data-kind': exportInfo.ok ? 'ok' : 'error' },
              exportInfo.ok ? `${t('exported')} ${exportInfo.path} (${fmtBytes(exportInfo.bytes)})` : exportInfo.message,
            )
          : null,
        planError !== null
          ? h(
              'div',
              null,
              h('div', { className: 'dsm-label', style: { marginTop: 16 } }, t('preview')),
              h('div', { className: 'dsm-alert', 'data-kind': 'error' }, `${t('planBlocked')}: ${planError.message}`),
            )
          : null,
        plan !== null ? h(PlanPreview, { t, plan }) : null,
        plan !== null && plan.files?.enabled && plan.files?.blocked
          ? h('div', { className: 'dsm-alert', 'data-kind': 'error' }, `${t('filesBlocked')}: ${(plan.files.problems ?? []).join(' / ')}`)
          : null,
        result !== null ? h(MoveResult, { t, result }) : null,
      )
    }

    /**
     * Dry-run preview block.
     * @param {object} props `{ t, plan }`.
     * @returns {object} element.
     */
    function PlanPreview({ t, plan }) {
      const sameKey = plan.sourceKey === plan.targetKey
      return h(
        'div',
        null,
        h('div', { className: 'dsm-label', style: { marginTop: 16 } }, t('preview')),
        h(
          'div',
          { className: 'dsm-card' },
          h(
            'dl',
            { className: 'dsm-kv' },
            h('dt', null, t('planFrom')),
            h('dd', null, h(Copyable, { text: plan.fromPath, t })),
            h('dt', null, t('planTo')),
            h('dd', null, h(Copyable, { text: plan.toPath, t })),
            h('dt', null, t('planTargetDir')),
            h('dd', null, h(Copyable, { text: plan.targetDir, t })),
            h('dt', null, t('planKeyChange')),
            h('dd', null, sameKey ? `${plan.sourceKey}（不变）` : `${plan.sourceKey} → ${plan.targetKey}`),
            h(
              'dt',
              null,
              t('planWorkspace'),
            ),
            h(
              'dd',
              null,
              plan.workspaceId !== null
                ? `${plan.workspaceTitle}`
                : `${plan.toPath}（${t('planWillCreate')}）`,
            ),
            h('dt', null, t('size')),
            h('dd', null, `${fmtBytes(plan.sizeBytes)} · ${fmtNumber(plan.frames)} ${t('frames')}`),
            plan.files?.enabled
              ? h('dt', null, t('planFiles'))
              : null,
            plan.files?.enabled
              ? h('dd', null, `${plan.files.entryCount} ${t('planFilesSummary')} · ${fmtBytes(plan.files.bytes)}${plan.files.truncatedMeasure ? ' (partial measure)' : ''}`)
              : null,
          ),
        ),
      )
    }

    /**
     * Migration result block.
     * @param {object} props `{ t, result }`.
     * @returns {object} element.
     */
    function MoveResult({ t, result }) {
      if (result.ok !== true) {
        const failure = result.error
        const steps = failure?.details?.steps ?? []
        return h(
          'div',
          null,
          h('div', { className: 'dsm-label', style: { marginTop: 16 } }, t('result')),
          h('div', { className: 'dsm-alert', 'data-kind': 'error' }, `${failure?.code ?? 'error'}: ${failure?.message ?? t('unknownError')}`),
          steps.length > 0
            ? h(
                'div',
                { className: 'dsm-steps' },
                steps.map((step, index) =>
                  h(
                    'div',
                    { key: `${step.name}-${index}`, className: 'dsm-step', 'data-status': step.status },
                    h('span', { className: 'dsm-step-name' }, step.name),
                    h('span', { className: 'dsm-step-detail' }, step.detail),
                  ),
                ),
              )
            : null,
          Array.isArray(failure?.details?.rollbackCommands) && failure.details.rollbackCommands.length > 0
            ? h(React.Fragment, null, h('div', { className: 'dsm-label', style: { marginTop: 12 } }, t('rollbackCmd')), h('pre', { className: 'dsm-pre' }, failure.details.rollbackCommands.join('\n')))
            : null,
        )
      }
      const data = result.data
      const accounting = data.accounting ?? {}
      return h(
        'div',
        null,
        h('div', { className: 'dsm-label', style: { marginTop: 16 } }, t('result')),
        h(
          'div',
          { className: 'dsm-steps' },
          (data.steps ?? []).map((step, index) =>
            h(
              'div',
              { key: `${step.name}-${index}`, className: 'dsm-step', 'data-status': step.status },
              h('span', { className: 'dsm-step-name' }, step.name),
              h('span', { className: 'dsm-step-detail' }, step.detail),
            ),
          ),
        ),
        data.verify !== undefined
          ? h(
              'div',
              { className: 'dsm-alert', 'data-kind': data.verify.ok ? 'ok' : 'error' },
              `${t('verify')}: ${data.verify.ok ? 'OK' : 'FAILED'} — ${data.verify.comparedBytes ?? 0} bytes, frames ${data.verify.beforeFrames ?? '?'} → ${data.verify.afterFrames ?? '?'}`,
            )
          : null,
        accounting.status !== undefined
          ? h(
              'div',
              { className: 'dsm-alert', 'data-kind': accounting.status === 'attached' ? 'ok' : 'warn' },
              `${t('accounting')}: ${accounting.status} — ${accounting.detail ?? ''}`,
            )
          : null,
        data.restartRequired === true
          ? h('div', { className: 'dsm-alert', 'data-kind': 'warn' }, `${t('restart')}：${t('restartDetail')}`)
          : null,
        Array.isArray(data.rollbackCommands) && data.rollbackCommands.length > 0
          ? h(React.Fragment, null, h('div', { className: 'dsm-label', style: { marginTop: 12 } }, t('rollbackCmd')), h('pre', { className: 'dsm-pre' }, data.rollbackCommands.join('\n')))
          : null,
      )
    }

    /**
     * Health-check pane.
     * @param {object} props component props.
     * @returns {object} element.
     */
    function DoctorPane({ t, doctor, busy, onRun, onRepair, repairInfo }) {
      const issues = doctor?.issues ?? []
      const dangling = issues.filter((issue) => issue.code === 'dangling-reference')
      return h(
        'div',
        { className: 'dsm-col-right', style: { flex: '1 1 auto' } },
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 } },
          h(Button, { onClick: onRun, disabled: busy === true }, busy ? t('doctorRunning') : t('doctorRun')),
          h(Button, { onClick: onRepair, disabled: busy === true || dangling.length === 0, variant: dangling.length > 0 ? 'danger' : undefined }, busy ? t('repairing') : `${t('repair')} (${dangling.length})`),
          h('span', { className: 'dsm-spacer' }),
          doctor?.summary !== undefined
            ? h(
                'span',
                { className: 'dsm-hint' },
                t('doctorSummary', {
                  sessions: doctor.summary.sessions,
                  workspaces: doctor.summary.workspaces,
                  errors: doctor.summary.errors,
                  warnings: doctor.summary.warnings,
                }),
              )
            : null,
        ),
        repairInfo !== null && repairInfo !== undefined
          ? h(
              'div',
              { className: 'dsm-alert', 'data-kind': repairInfo.ok === false ? 'error' : 'ok' },
              repairInfo.ok === false ? repairInfo.error : t('repairDone', { count: (repairInfo.removed ?? []).length }),
            )
          : null,
        doctor?.registryError ? h('div', { className: 'dsm-alert', 'data-kind': 'warn' }, `workspace.json: ${doctor.registryError}`) : null,
        issues.length === 0
          ? h('div', { className: 'dsm-empty' }, doctor === null ? t('doctorRun') : t('doctorClean'))
          : issues.map((issue, index) =>
              h(
                'div',
                { key: `${issue.code}-${index}`, className: 'dsm-issue', 'data-sev': issue.severity },
                h(IconWarn),
                h(
                  'div',
                  { style: { minWidth: 0, flex: '1 1 auto' } },
                  h('div', { style: { display: 'flex', gap: 8, alignItems: 'baseline' } }, h('span', { className: 'dsm-issue-code' }, issue.code), h('span', null, issue.message)),
                  issue.path !== undefined ? h('div', { className: 'dsm-hint dsm-mono', title: issue.path }, issue.path) : null,
                ),
              ),
            ),
      )
    }

    /**
     * Deferred-membership pane.
     * @param {object} props component props.
     * @returns {object} element.
     */
    function PendingPane({ t, pending, busy, onApply }) {
      const entries = pending?.entries ?? []
      const lastApply = pending?.lastApply ?? null
      return h(
        'div',
        { className: 'dsm-col-right', style: { flex: '1 1 auto' } },
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 } },
          h(Button, { onClick: onApply, disabled: busy === true || entries.length === 0 }, busy ? t('pendingApplying') : t('pendingApply')),
          h('span', { className: 'dsm-spacer' }),
          h('span', { className: 'dsm-hint' }, t('pendingHint')),
        ),
        entries.length === 0 ? h('div', { className: 'dsm-empty' }, t('pendingEmpty')) : null,
        entries.map((entry, index) =>
          h(
            'div',
            { key: `${entry.id}-${index}`, className: 'dsm-card', style: { marginBottom: 8 } },
            h(
              'dl',
              { className: 'dsm-kv' },
              h('dt', null, t('id')),
              h('dd', null, h(Copyable, { text: entry.id, t })),
              h('dt', null, t('planTo')),
              h('dd', null, h(Copyable, { text: entry.toPath, t })),
              h('dt', null, t('attempts')),
              h('dd', null, String(entry.attempts ?? 0)),
              entry.lastError
                ? h(React.Fragment, null, h('dt', null, t('lastError')), h('dd', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, String(entry.lastError)))
                : null,
            ),
          ),
        ),
        lastApply !== null
          ? h(
              'div',
              { className: 'dsm-alert', 'data-kind': (lastApply.remaining ?? []).length === 0 ? 'ok' : 'warn' },
              `${t('applied')}: ${(lastApply.applied ?? []).length} · ${t('remaining')}: ${(lastApply.remaining ?? []).length}`,
            )
          : null,
      )
    }

    // -------------------------------------------------------------------- apply

    /**
     * Register both slots. Everything is owned by this plugin's context, so
     * unloading the plugin removes the button and the dialog.
     * @param {object} ctx Client plugin context.
     */
    function apply(ctx) {
      const store = createStore()
      const t = makeTranslator(ctx)
      const api = safeGet(ctx, 'uiWorkspace')

      ctx.slots.inject('conversation.session.header.utilities', () =>
        ctx.slots.register(
          { name: 'conversation.session.header.utilities', id: 'session-migration', order: 30 },
          (props) => h(HeaderButton, { store, t, sessionId: props?.sessionId ?? null }),
        ),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'session-migration-dialog', order: 20 }, () => h(PanelHost, { store, t, api })),
      )
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
