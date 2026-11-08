import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Contract test for the browser half: the file must be a lazy CJS factory
 * (`window.__ModuleLoader__.load({id, factory})`) whose exports expose `apply`
 * and `inject`, and whose two slot registrations must render without throwing.
 *
 * A minimal React shim stands in for the browser module table, so this catches
 * top-level errors, wrong export shapes and hook misuse at render time without a
 * browser.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/**
 * Minimal React surface used by the bundle.
 * @returns {object} React-like object.
 */
function reactShim() {
  return {
    Fragment: 'Fragment',
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } }
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect() {},
    useLayoutEffect() {},
    useMemo(factory) {
      return factory()
    },
    useCallback(fn) {
      return fn
    },
    useRef(value) {
      return { current: value }
    },
    useSyncExternalStore(_subscribe, get) {
      return get()
    },
  }
}

/**
 * Render one element tree by calling function components, like React would.
 * @param {any} node element, array, or primitive.
 * @param {number} [depth] recursion guard.
 * @returns {any} rendered tree (host elements keep their type and props).
 */
function render(node, depth = 0) {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (Array.isArray(node)) return node.map((child) => render(child, depth))
  if (typeof node === 'string' || typeof node === 'number') return node
  if (depth > 60) throw new Error('render depth exceeded')
  if (typeof node.type === 'function') return render(node.type(node.props), depth + 1)
  return { ...node, props: { ...node.props, children: render(node.props?.children, depth + 1) } }
}

/**
 * Collect every host element of one tag in a rendered tree.
 * @param {any} node rendered tree.
 * @param {string} tag host tag name.
 * @returns {object[]} matching elements.
 */
function collect(node, tag) {
  const found = []
  const walk = (current) => {
    if (current === null || current === undefined) return
    if (Array.isArray(current)) {
      for (const child of current) walk(child)
      return
    }
    if (typeof current !== 'object') return
    if (current.type === tag) found.push(current)
    walk(current.props?.children)
  }
  walk(node)
  return found
}

/**
 * Load the bundle the way the shell does, and apply it to a fake slot registry.
 * @returns {object} captured registrations plus the plugin context.
 */
function loadBundle() {
  const registrations = []
  const injections = []
  let moduleRegistration = null

  const windowShim = {
    __ModuleLoader__: {
      load(registration) {
        moduleRegistration = registration
      },
    },
  }
  // The real loader evaluates the bundle as a plain script and calls the factory
  // with `require` only — no surrounding `module`/`exports`. Reproducing that
  // exactly is what catches a factory that assumes CJS globals.
  const run = new Function('window', source)
  run(windowShim)

  assert.notEqual(moduleRegistration, null, 'the bundle registers itself with the module loader')
  assert.equal(moduleRegistration.id, 'dsh-session-migration')

  const exported = moduleRegistration.factory((specifier) => {
    if (specifier === 'react') return reactShim()
    throw new Error(`unexpected external: ${specifier}`)
  })
  const ctx = {
    get: () => undefined,
    slots: {
      inject(key, callback) {
        injections.push(key)
        return callback()
      },
      register(options, component) {
        registrations.push({ ...options, component })
        return () => {}
      },
    },
  }
  exported.apply(ctx)
  return { exported, registrations, injections, ctx }
}

/**
 * @param {object[]} registrations captured slot registrations.
 * @param {string} name slot name.
 * @returns {object} the registration.
 */
function slotRegistration(registrations, name) {
  const found = registrations.find((entry) => entry.name === name)
  assert.notEqual(found, undefined, `no registration for ${name}`)
  return found
}

test('client bundle exports the CJS plugin face', () => {
  const { exported } = loadBundle()
  assert.equal(typeof exported.apply, 'function')
  assert.deepEqual(exported.inject, ['slots'])
})

test('client bundle registers the header button and the overlay dialog', () => {
  const { registrations, injections } = loadBundle()
  assert.deepEqual(injections.sort(), ['conversation.session.header.utilities', 'shell.overlay'])
  assert.equal(slotRegistration(registrations, 'conversation.session.header.utilities').id, 'session-migration')
  assert.equal(slotRegistration(registrations, 'shell.overlay').id, 'session-migration-dialog')
})

test('the dialog stays unmounted until the header button opens it', () => {
  const { registrations } = loadBundle()
  const header = slotRegistration(registrations, 'conversation.session.header.utilities')
  const overlay = slotRegistration(registrations, 'shell.overlay')

  assert.equal(render(overlay.component({})), null, 'a closed dialog renders nothing')

  const entry = collect(render(header.component({ sessionId: 'session-x' })), 'button')
  assert.equal(entry.length, 1)
  assert.equal(typeof entry[0].props.onClick, 'function')
  entry[0].props.onClick()

  const dialog = render(overlay.component({}))
  assert.notEqual(dialog, null, 'opening the store mounts the dialog')
  const divs = collect(dialog, 'div')
  assert.ok(divs.some((element) => element.props.className === 'dsm-backdrop'), 'renders the modal backdrop')
  const tabs = collect(dialog, 'button').filter((element) => element.props.className === 'dsm-tab')
  assert.equal(tabs.length, 3, 'migrate / health / pending tabs')
})

test('the header button reflects the open state through aria-expanded', () => {
  const { registrations } = loadBundle()
  const header = slotRegistration(registrations, 'conversation.session.header.utilities')

  const read = () => collect(render(header.component({ sessionId: 'session-y' })), 'button')[0]
  assert.equal(read().props['aria-expanded'], 'false')
  read().props.onClick()
  assert.equal(read().props['aria-expanded'], 'true')
  assert.equal(read().props['data-active'], 'true')
})
