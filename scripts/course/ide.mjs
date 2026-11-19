// What the command-line tools for course development (P71: chain.mjs,
// step-images.mjs) share: they open the deployed glpython IDE in headless
// Chrome (playwright-core, the installed Google Chrome, as test:console),
// with the project in the link, run the file, enter the call in the REPL and
// visualize it - what a learner does. So they show what learners see, need
// no build, and leave the working tree alone. Each run has a browser
// profile of its own: no stored settings carry over.
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { chromium } from 'playwright-core'

// GLPYTHON_IDE_URL: another IDE in place of the chosen one (e.g. a local
// `vite preview` of an IDE build, to check a fix before it is deployed).
export const IDES = process.env.GLPYTHON_IDE_URL
  ? { live: process.env.GLPYTHON_IDE_URL, dev: process.env.GLPYTHON_IDE_URL }
  : { live: 'https://glpython-edu.github.io/', dev: 'https://glpython-edu.github.io/dev/' }

// A mistake of the caller (an option, a file, a feature the IDE lacks):
// its message, exit code 2. A Python error is exit code 1.
export class UsageError extends Error {}
export class PythonError extends Error {}

// "--name value", "--name=value" and flags; `repeat` names may come again.
export function parseArgs(argv, { flags = [], values = [], repeat = [] }) {
  const options = {}
  for (const name of repeat) options[name] = []
  for (let index = 0; index < argv.length; index++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(argv[index])
    if (!match) throw new UsageError(`unexpected argument: ${argv[index]}`)
    const [, name, inline] = match
    if (flags.includes(name)) {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value`)
      options[name] = true
      continue
    }
    if (!values.includes(name) && !repeat.includes(name)) throw new UsageError(`unknown option: --${name}`)
    const value = inline ?? argv[++index]
    if (value === undefined) throw new UsageError(`--${name} needs a value`)
    if (repeat.includes(name)) options[name].push(value)
    else options[name] = value
  }
  return options
}

// Paths are the caller's: `npm --prefix ../glpython-editor run …` runs the
// script in this repo, with the caller's folder in INIT_CWD.
export const callerPath = (path) => resolve(process.env.INIT_CWD ?? process.cwd(), path)

// The options both tools take, checked.
export function commonOptions(options) {
  if (!options.file) throw new UsageError('--file is missing')
  if (!options.call) throw new UsageError('--call is missing')
  const ide = options.ide ?? 'live'
  if (!IDES[ide]) throw new UsageError(`--ide is live or dev, not ${ide}`)
  const mode = options.mode ?? 'substitution'
  if (mode !== 'substitution' && mode !== 'box') throw new UsageError(`--mode is box or substitution, not ${mode}`)
  const read = (path) => {
    try { return readFileSync(callerPath(path), 'utf8') } catch (error) { throw new UsageError(`can't read ${path}: ${error.message}`) }
  }
  const files = [{ path: basename(options.file), code: read(options.file) }]
  for (const lib of options.lib ?? []) {
    const path = basename(lib)
    if (files.some((file) => file.path === path)) throw new UsageError(`two files named ${path}`)
    files.push({ path, code: read(lib), readOnly: true })
  }
  return { ide, mode, trees: options.trees === true, files, call: options.call }
}

// The IDE's share link (`#p=`: raw deflate, base64url, in the fragment, so
// any length works), see projectShare.ts in the IDE. The trees are off in a
// tab without settings: with `trees`, the IDE's other parts (features.ts's
// DEFAULT_FEATURES) and the trees.
const DEFAULT_FEATURES = ['run', 'tests', 'visualize', 'repl', 'export', 'coverage']
function projectLink(base, files, trees) {
  const payload = { v: 1, name: files[0].path.replace(/\.py$/, ''), mainFile: files[0].path, ...(trees ? { features: [...DEFAULT_FEATURES, 'tree'] } : {}), files: Object.fromEntries(files.map(({ path, code, readOnly }) => [path, { path, label: path, kind: 'python', code, ...(readOnly ? { readOnly } : {}) }])) }
  const encoded = deflateRawSync(Buffer.from(JSON.stringify(payload)), { level: 9 }).toString('base64url')
  return `${base}#p=${encoded}`
}

// The IDE's version.json, as one line for stderr.
export async function ideVersion(ide) {
  const response = await fetch(new URL('version.json', IDES[ide]), { cache: 'no-store' }).catch((error) => { throw new UsageError(`${IDES[ide]}: ${error.message}`) })
  // A local build has none (the deployment writes it).
  if (!response.ok) return `IDE ${ide} (${IDES[ide]}): no version.json (HTTP ${response.status})`
  const version = await response.json()
  return `IDE ${ide} (${IDES[ide]}): editor ${version.editor}, built ${version.built}`
}

// The visualizer's text of a step, on one line: the call's line as drawn
// (substituted values, inline calls), a call box as [f(x=1): return …]
// with its own boxes inside, an open tree as [Baum: its rows]. What the line doesn't
// show (line numbers, a box's variables, hints, error messages) is left out.
// `boxed`: a box or a tree is in it.
function stepTextIn(view) {
  let boxed = false
  const skip = ['frame-gutter-num', 'frame-vars', 'frame-hint', 'visual-error-message', 'visual-error-hint', 'visual-expectation-message', 'visualizer-connectors']
  const textOf = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const classes = node.classList
    if (skip.some((name) => classes.contains(name)) || node.getAttribute('aria-hidden') === 'true') return ''
    // A tree row by row, from the root down, each row left to right (a box
    // in it as a box).
    if (classes.contains('frame-tree')) {
      boxed = true
      const rows = new Map()
      for (const placed of node.querySelectorAll('[data-tree-key]')) {
        if (placed.closest('.frame-tree') !== node || placed.classList.contains('value-tree-ghost')) continue
        const top = parseFloat(placed.style.top)
        const text = placed.classList.contains('value-tree-box') ? [...placed.childNodes].map(textOf).join('').trim() : placed.textContent
        if (!rows.has(top)) rows.set(top, [])
        rows.get(top).push({ left: parseFloat(placed.style.left), text })
      }
      return `[Baum: ${[...rows].sort(([a], [b]) => a - b).map(([, row]) => row.sort((a, b) => a.left - b.left).map((placed) => placed.text).join('  ')).join(' / ')}]`
    }
    if (classes.contains('frame-box')) {
      boxed = true
      const lines = [...node.querySelectorAll(':scope > .frame-code > .frame-line')].map((line) => textOf(line).trim())
      return `[${lines.join(' ').replace(/^def /, '')}]`
    }
    return [...node.childNodes].map(textOf).join('')
  }
  const root = view.querySelector('.visualizer-canvas > .frame-box > .frame-code')
  if (!root) return { text: '', boxed }
  const text = [...root.querySelectorAll(':scope > .frame-line-row > .frame-line')].map((line) => textOf(line).replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ')
  return { text, boxed }
}

// Opens the IDE with the files, runs the main file, enters the call and
// visualizes it in the mode (with trees or not). Returns the page and
// helpers for its steps. A Python error throws PythonError with Python's
// text.
export async function openVisualizer({ ide, mode, trees, files, call }, { downloads = false } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1300, height: 900 }, locale: 'de-CH', reducedMotion: 'reduce', acceptDownloads: downloads })
    // «→ Kette kopieren» copies here: no clipboard, no permission.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.glpythonCopied = text } } })
    })
    const page = await context.newPage()
    await page.goto(projectLink(IDES[ide], files, trees))
    await page.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 120000 })
    const runButton = page.getByRole('button', { name: 'Ausführen', exact: true })
    // Python is ready when its badge is gone (the first start loads Pyodide).
    await page.locator('.runtime-badge').waitFor({ state: 'detached', timeout: 300000 })
    await runButton.click()
    await settled(page, runButton)
    // The program's output ends with Python's traceback (without the IDE's
    // hint below it) if the file failed; a syntax error has no "Traceback"
    // line, it starts at its file and line.
    const output = await page.locator('.console > pre').first().evaluate((pre) => {
      const copy = pre.cloneNode(true)
      for (const hint of copy.querySelectorAll('.error-hint')) hint.remove()
      return copy.textContent
    })
    let traceback = output.search(/^Traceback \(most recent call last\):$/m)
    if (traceback === -1 && /(^|\n)(SyntaxError|IndentationError|TabError): [^\n]*\s*$/.test(output)) traceback = output.search(/^ {2}File "[^"\n]*", line \d+$/m)
    if (traceback !== -1) throw new PythonError(output.slice(traceback).trimEnd())

    const repl = page.locator('.repl-line .repl-input')
    await repl.fill(call)
    await repl.press('Enter')
    const entry = page.locator('.repl-entry').last()
    const visualize = entry.locator('.repl-entry-visualize:not([disabled])')
    const callError = entry.locator('.output-error')
    await visualize.or(callError).first().waitFor({ timeout: 120000 })
    await settled(page, runButton)
    if (await callError.count() > 0) throw new PythonError(await callError.last().evaluate((error) => {
      const copy = error.cloneNode(true)
      for (const hint of copy.querySelectorAll('.error-hint')) hint.remove()
      return copy.textContent.trimEnd()
    }))
    await visualize.click()
    const count = page.locator('.visualizer-step-count')
    await count.filter({ hasText: /Vor der Ausführung|Keine Schritte/ }).waitFor({ timeout: 120000 })
    await setView(page, ide, mode, trees)
    return { browser, page, ...stepsOf(page) }
  } catch (error) {
    await browser.close()
    throw error
  }
}

// Python is done once the run button is back and the console has stopped
// changing for a moment.
async function settled(page, runButton) {
  await runButton.waitFor({ timeout: 300000 })
  let last = null
  for (let same = 0; same < 4;) {
    await page.waitForTimeout(250)
    const text = await page.locator('.console').innerText()
    same = text === last && await runButton.isVisible() ? same + 1 : 0
    last = text
  }
}

// The mode, and «Ausdrücke als Bäume auswerten» in «⋯ Optionen» (since P65;
// before, on live, «Baum» was a mode of its own, «Ersetzung» with trees).
async function setView(page, ide, mode, trees) {
  const modeButton = (name) => page.locator('.visualizer-mode button', { hasText: name })
  const option = page.getByRole('menuitemcheckbox', { name: 'Ausdrücke als Bäume auswerten' })
  await page.locator('.visualizer-options-button').click()
  const hasOption = await option.count() > 0
  if (hasOption) {
    if ((await option.getAttribute('aria-checked') === 'true') !== trees) await option.click()
    await page.keyboard.press('Escape')
    await modeButton(mode === 'box' ? 'Kasten' : 'Ersetzung').click()
    return
  }
  await page.keyboard.press('Escape')
  if (trees && mode === 'box') throw new UsageError(`the ${ide} IDE has no trees in «Kasten» (only the mode «Baum», «Ersetzung» with trees): leave out --mode box or use --ide dev`)
  if (trees && await modeButton('Baum').count() === 0) throw new UsageError(`the ${ide} IDE has no trees`)
  await modeButton(trees ? 'Baum' : mode === 'box' ? 'Kasten' : 'Ersetzung').click()
}

function stepsOf(page) {
  const count = page.locator('.visualizer-step-count')
  const button = (index) => page.locator('.visualizer-controls button').nth(index)
  // The counter's number: 0 before the start, else «Schritt k von n».
  const position = async () => {
    const text = await count.innerText()
    const match = /(\d+) von (\d+)/.exec(text)
    return match ? { step: Number(match[1]), of: Number(match[2]) } : { step: 0, of: null }
  }
  // The text once it settled (a tree's boxes are sized a render later).
  const shown = async () => {
    let last = await page.locator('.visualizer-view').evaluate(stepTextIn)
    for (;;) {
      await page.waitForTimeout(120)
      const now = await page.locator('.visualizer-view').evaluate(stepTextIn)
      if (now.text === last.text && now.boxed === last.boxed) return now
      last = now
    }
  }
  // Every step from 0 on: { step, text, boxed }.
  const allSteps = async () => {
    if (await button(0).isEnabled()) await button(0).click()
    const steps = []
    for (;;) {
      const { step } = await position()
      steps.push({ step, ...await shown() })
      if (!(await button(2).isEnabled())) return steps
      await button(2).click()
      await count.filter({ hasText: `Schritt ${step + 1} von` }).waitFor({ timeout: 30000 })
    }
  }
  // «→ Kette kopieren», as copied.
  const chain = async () => {
    if (await button(3).isEnabled()) await button(3).click()
    await page.locator('.visualizer-options-button').click()
    const item = page.locator('.visualizer-chain-copy')
    if (await item.count() === 0) throw new UsageError('this IDE has no «→ Kette kopieren»')
    if (await item.isDisabled()) throw new UsageError('the call has no → chain (a definition or a statement without an expression)')
    await page.evaluate(() => { window.glpythonCopied = undefined })
    await item.click()
    await page.waitForFunction(() => window.glpythonCopied !== undefined, null, { timeout: 10000 })
    const copied = await page.evaluate(() => window.glpythonCopied)
    await page.keyboard.press('Escape')
    return copied
  }
  return { position, allSteps, chain }
}

// Runs a tool's main function: a usage error (exit 2) or a Python error
// (exit 1) as a message on stderr, without a stack.
export async function main(run) {
  try {
    await run()
  } catch (error) {
    if (error instanceof PythonError) {
      console.error(error.message)
      process.exitCode = 1
    } else if (error instanceof UsageError) {
      console.error(`error: ${error.message}`)
      process.exitCode = 2
    } else throw error
  }
}
