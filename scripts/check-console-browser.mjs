// Browser check of the console: Tests, then an edit, then Tests again -
// without ▶ Run in between - runs the edited code, and its report is in
// view, also when the learner scrolled up to read the first report (P20:
// the second report used to land out of view below the first one). Tests
// starts as Run does, so the console then holds only the new report, and
// the REPL has the definitions just tested (not the ones of the last Run).
// With "coverage" in features (P23), a report that all passed lists the
// lines no example executed - which also checks that Pyodide's Python has
// sys.monitoring - and without it, or with a failing example, it doesn't.
// input() (P36) asks in the console's input line where the parent page is
// cross-origin isolated (a recursive REPL, Stop and Ctrl+D → EOFError, the
// visualizer), and without isolation stops with an error and its hint.
// The visualizer (P39): a named list indexed in one step, a long list
// abbreviated in the step and the variables and shown in full on request.
// A display of literals has no steps, in Ersetzung and Kasten (P40); every
// step changes the code or the variables.
// The run file is the module __main__ (P37), also in the REPL after it.
// With listtree, lists that read as a tree are drawn as one, in the
// variables, the full-value dialog and on request for a REPL value; nothing
// of it without. Their layout: no two nodes overlap, children in order below
// their parent, the parent centred over them. In a narrow embed (420px) a
// wide tree starts with its root in the middle, shows a hint at each edge
// where more is hidden, and scrolls with the keyboard.
// A steady height: while stepping through a visualization the embed keeps
// one height (the visualizer the tallest step's, at most 80% of the window,
// the console the last step's output), and the current line stays in view.
// The mode «Baum» (with "tree"): «Ersetzung»'s steps plus open and close
// for each tree, nodes that stay in place, one height, and the hint at a
// call that stays a box (also in «Ersetzung»); without "tree" no button.
//
// Drives the built embed (dist-embed/, from npm run build:embed) in Chrome
// through its protocol, as the LiaScript macro does; Pyodide comes from its
// CDN. Needs Google Chrome (GitHub's ubuntu-latest has it).
//
//   npm run build:embed && npm run test:console
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const port = 4185
const origin = `http://localhost:${port}`
const server = spawn('npx', ['vite', 'preview', '--config', 'vite.embed.config.ts', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
const stopServer = () => server.kill()
process.on('exit', stopServer)

// The parent page, served on the embed's own origin: it loads the embed and
// passes messages on, version 4. Its own query (e.g. "?features=…") goes on
// to the embed. As the LiaScript macro does, it sets the iframe to the
// height the embed reports, at most "?cap=" (default 900px; the macro: 80%
// of the course's visible height) - then the embed scrolls inside.
const harness = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="embed" style="width:760px;height:170px;border:0"></iframe>
<script>
  const iframe = document.querySelector('#embed')
  let cap = Number(new URLSearchParams(location.search).get('cap')) || 900
  const fit = () => { if (window.reported) iframe.style.height = Math.min(cap, window.reported.height) + 'px' }
  window.setCap = (height) => { cap = height; fit() }
  window.ready = false
  window.send = (type, source) => iframe.contentWindow.postMessage({ type: 'glpython:' + type, version: 4, source, mode: 'eval' }, location.origin)
  addEventListener('message', (event) => {
    if (event.data?.type === 'glpython:ready') window.ready = true
    if (event.data?.type === 'glpython:resize') { window.reported = event.data; fit() }
  })
  iframe.src = './index.html?parentOrigin=' + encodeURIComponent(location.origin) + '&mode=eval&lang=de' + location.search.replace('?', '&')
</script>`

const program = (examples) => `def schnitt(a, b):\n    """\n${examples.map(([call, want]) => `    >>> ${call}\n    ${want}\n`).join('')}    """\n    return (a + b) / 2\n`
// Enough failing examples that the report is taller than the console.
const failing = program([['schnitt(4, 6)', '6'], ['schnitt(6, 4)', '4.5'], ['schnitt(2, 2)', '3'], ['schnitt(1, 1)', '7'], ['schnitt(0, 4)', '1']])
const edited = program([['schnitt(4, 6)', '5.0'], ['schnitt(6, 4)', '4.5'], ['schnitt(2, 2)', '3'], ['schnitt(1, 1)', '7'], ['schnitt(0, 4)', '1']])
// "5" for 5.0 passes: Tests compares values, not their display.
const passing = program([['schnitt(4, 6)', '5']])
const passingEdited = program([['schnitt(4, 6)', '5'], ['schnitt(1, 2)', '1.5']])

let failed = 0
const browser = await chromium.launch({ channel: 'chrome', headless: true })
// Pyodide and Monaco come from jsDelivr (about 18 MB). Each case has a page
// in a browser context of its own, so that storage, routes and headers don't
// carry over - and a new context starts with an empty HTTP cache: every case
// downloaded all of it again, some 25 times per run, and now and then a
// download stalled past a case's 60 s (P58). Instead each file is fetched
// once per run and served from memory to every context. A failed fetch is
// not retried: the request fails, as it would in the browser.
const cdn = new Map()
let served = 0
const newPage = async (options) => {
  const context = await browser.newContext(options)
  await context.route('https://cdn.jsdelivr.net/**', async (route) => {
    const url = route.request().url()
    served += 1
    if (!cdn.has(url)) cdn.set(url, route.fetch().then(async (response) => ({ status: response.status(), headers: response.headers(), body: await response.body() })))
    let file
    try { file = await cdn.get(url) } catch { cdn.delete(url); return route.abort('failed') }
    if (file.status >= 400) cdn.delete(url)
    // The body is already decoded.
    const headers = Object.fromEntries(Object.entries(file.headers).filter(([name]) => name !== 'content-encoding' && name !== 'content-length'))
    await route.fulfill({ status: file.status, headers, body: file.body })
  })
  const page = await context.newPage()
  page.on('close', () => { context.close().catch(() => {}) })
  return page
}
try {
  for (let attempt = 0; ; attempt++) {
    try { await fetch(`${origin}/index.html`); break } catch { if (attempt > 50) throw new Error('vite preview did not start') }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  // Pyodide's files first, before any case: then a case's 60 s are for
  // Python, not for the network, and a CDN that doesn't answer is reported
  // as such instead of as a slow case.
  {
    const page = await newPage({ viewport: { width: 800, height: 950 } })
    await page.route(`${origin}/check-console.html`, (route) => route.fulfill({ contentType: 'text/html', body: harness }))
    await page.goto(`${origin}/check-console.html`)
    await page.waitForFunction(() => window.ready, null, { timeout: 120000 })
    await page.evaluate(() => window.send('run', 'print("warm")'))
    await page.frameLocator('#embed').locator('.console').filter({ hasText: 'warm' }).waitFor({ timeout: 300000 })
      .catch(() => { throw new Error('Pyodide did not load from jsDelivr within 5 minutes') })
    await page.close()
  }
  for (const [label, first, second, firstSummary, secondSummary] of [
    ['Tests → fail → edit → Tests', failing, edited, '0 von 5 Beispielen bestanden', '1 von 5 Beispielen bestanden'],
    ['Tests → pass → edit → Tests', passing, passingEdited, '1 von 1 Beispielen bestanden', '2 von 2 Beispielen bestanden'],
  ]) {
    const page = await newPage({ viewport: { width: 800, height: 950 } })
    await page.route(`${origin}/check-console.html`, (route) => route.fulfill({ contentType: 'text/html', body: harness }))
    await page.goto(`${origin}/check-console.html`)
    await page.waitForFunction(() => window.ready, null, { timeout: 120000 })
    const frame = page.frameLocator('#embed')
    const summaries = frame.locator('.test-summary')
    await page.evaluate((source) => window.send('test', source), first)
    await summaries.first().waitFor({ timeout: 60000 })
    const firstSeen = await summaries.allInnerTexts()
    // The learner reads the report from its top.
    await frame.locator('.console').evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
    await page.evaluate((source) => window.send('test', source), second)
    // The new report: its summary appears (before the fix: as a second one).
    await page.frames()[1].waitForFunction((want) => [...document.querySelectorAll('.test-summary')].some((summary) => summary.textContent === want), secondSummary, { timeout: 60000 })
    await page.waitForTimeout(300)
    try {
      assert.deepEqual(firstSeen, [firstSummary], `${label}: the first run's report`)
      assert.deepEqual(await summaries.allInnerTexts(), [secondSummary], `${label}: the second run tests the edited code, in an emptied console`)
      const inView = await frame.locator('.console').evaluate((element) => {
        const view = element.getBoundingClientRect()
        const summary = [...element.querySelectorAll('.test-summary')].at(-1).getBoundingClientRect()
        return summary.top >= view.top && summary.bottom <= view.bottom
      })
      assert.ok(inView, `${label}: the new report's summary is in the console's view`)
      console.log(`${label}: ok`)
    } catch (error) {
      failed += 1
      console.error(error.message)
    }
    await page.close()
  }
  // Edit → Tests → the REPL uses the new definition, without ▶ Run.
  const page = await newPage({ viewport: { width: 800, height: 950 } })
  await page.route(`${origin}/check-console.html`, (route) => route.fulfill({ contentType: 'text/html', body: harness }))
  await page.goto(`${origin}/check-console.html`)
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 })
  const frame = page.frameLocator('#embed')
  const repl = frame.getByRole('textbox', { name: 'Python-Eingabe' })
  const ask = async (input) => {
    const count = await frame.locator('.repl-value, .repl-entry .output-error').count()
    await repl.fill(input)
    await repl.press('Enter')
    await frame.locator('.repl-value, .repl-entry .output-error').nth(count).waitFor({ timeout: 30000 })
    return frame.locator('.repl-value, .repl-entry .output-error').nth(count).innerText()
  }
  const version = (value) => `def f():\n    """\n    >>> f()\n    ${value}\n    """\n    return ${value}\n`
  await page.evaluate((source) => window.send('test', source), version(1))
  await frame.locator('.test-summary').waitFor({ timeout: 60000 })
  const before = await ask('f()')
  await page.evaluate((source) => window.send('test', source), version(2))
  // Tests empties the console (before: the REPL entry stayed).
  await frame.locator('.repl-entry').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await frame.locator('.test-summary').last().waitFor({ timeout: 60000 })
  await page.waitForTimeout(500)
  const after = await ask('f()')
  try {
    assert.deepEqual([before, after], ['1', '2'], 'edit → Tests → the REPL uses the new definition')
    console.log('Tests → REPL → edit → Tests → REPL: ok')
  } catch (error) {
    failed += 1
    console.error(error.message)
  }
  await page.close()

  // Coverage after Tests.
  const bewertung = `def bewertung(note):\n    """\n    >>> bewertung(5)\n    'genügend'\n    >>> bewertung(6)\n    'genügend'\n    """\n    if note >= 4:\n        return "genügend"\n    else:\n        return "ungenügend"\n`
  const istGenuegend = `def ist_genuegend(note):\n    """\n    >>> ist_genuegend(5.5)\n    True\n    >>> ist_genuegend(3.5)\n    False\n    """\n    return note >= 4\n`
  const bewertungFailing = bewertung.replace(">>> bewertung(6)\n    'genügend'", ">>> bewertung(6)\n    'gut'")
  for (const [label, query, source, expected] of [
    ['coverage: a line no example ran', '?features=run,repl,visualize,tests,coverage', bewertung, 'Von keinem Beispiel ausgeführt:\nZeile 11: return "ungenügend"'],
    ['coverage: every line ran', '?features=run,repl,visualize,tests,coverage', istGenuegend, 'Jede Zeile der Funktionen wurde von mindestens einem Beispiel ausgeführt. Ob die Beispiele auch die Grenzfälle prüfen, zeigt das nicht.'],
    ['coverage: not with a failing example', '?features=run,repl,visualize,tests,coverage', bewertungFailing, null],
    ['coverage: not without it in features', '?features=run,repl,visualize,tests', bewertung, null],
    ['coverage: not without features', '', bewertung, null],
  ]) {
    const page = await newPage({ viewport: { width: 800, height: 950 } })
    await page.route((url) => url.pathname === '/check-console.html', (route) => route.fulfill({ contentType: 'text/html', body: harness }))
    await page.goto(`${origin}/check-console.html${query}`)
    await page.waitForFunction(() => window.ready, null, { timeout: 120000 })
    const frame = page.frameLocator('#embed')
    await page.evaluate((source) => window.send('test', source), source)
    await frame.locator('.test-summary').waitFor({ timeout: 60000 })
    try {
      const coverage = (await frame.locator('.test-coverage').allInnerTexts()).map((text) => text.replace(/\n+/g, '\n'))
      assert.deepEqual(coverage, expected === null ? [] : [expected], label)
      console.log(`${label}: ok`)
    } catch (error) {
      failed += 1
      console.error(error.message)
    }
    await page.close()
  }

  // input() asks in the console's input line (P36). The parent page sends
  // COOP/COEP, so the embed is cross-origin isolated and can wait, as the IDE.
  const isolated = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  const language = 'def berechnen(text):\n    return eval(text)\n\ndef repl():\n    text = input("> ")\n    if text == "ende":\n        return\n    print(berechnen(text))\n    repl()\n'
  const openEmbed = async (headers, query = '', width = 760) => {
    const page = await newPage({ viewport: { width: 800, height: 950 } })
    await page.route((url) => url.pathname === '/check-console.html', (route) => route.fulfill({ contentType: 'text/html', body: harness.replace('width:760px', `width:${width}px`), headers }))
    await page.goto(`${origin}/check-console.html${query}`)
    await page.waitForFunction(() => window.ready, null, { timeout: 120000 })
    return page
  }
  // The transcript as it reads, without the entries' Visualize buttons: next
  // to a ">>>" line or on a line of their own, depending on the width.
  const consoleText = (frame) => frame.locator('.console').evaluate((console) => {
    const buttons = [...console.querySelectorAll('.repl-entry-visualize, .repl-entry-tree')]
    for (const button of buttons) button.style.display = 'none'
    const text = console.innerText
    for (const button of buttons) button.style.display = ''
    return text
  })
  // A visualization is shown once its steps are measured: until then the
  // embed draws some steps a second time, hidden, to know their height.
  const measured = (frame) => frame.locator('.visualizer-view[data-steady-height="done"]').waitFor({ timeout: 30000 })
  const programLine = (frame) => frame.locator('.repl-line--program .repl-input')
  // A global variable's box (P53): hovering over its entry in the footer.
  const peekOf = async (frame, name) => {
    // An open box may cover the entry: leave it first, it closes.
    const page = frame.owner().page()
    await page.mouse.move(0, 0)
    await frame.locator('.visualizer-globals-peek').waitFor({ state: 'detached', timeout: 5000 })
    await frame.locator(`.visualizer-globals .locals-row[data-name="${name}"]`).hover()
    const peek = frame.locator('.visualizer-globals-peek')
    await peek.waitFor({ timeout: 5000 })
    return peek
  }
  // A REPL input, once the REPL is free again (until then it keeps the text).
  const enterRepl = async (frame, text) => {
    const repl = frame.locator('.repl-line .repl-input')
    await frame.getByRole('textbox', { name: 'Python-Eingabe' }).fill(text)
    for (let attempt = 0; attempt < 100 && await repl.inputValue() === text; attempt++) {
      await repl.press('Enter')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  const answer = async (frame, text, prompt = '> ') => {
    await programLine(frame).waitFor({ timeout: 30000 })
    assert.equal(await frame.locator('.repl-line--program .repl-prompt').textContent(), prompt, 'the input line shows the prompt')
    // While it waits, the REPL's >>> line is the program's input line.
    assert.equal(await frame.locator('.repl-line:not(.repl-line--program)').count(), 0, 'no >>> line while the program waits')
    await programLine(frame).fill(text)
    await programLine(frame).press('Enter')
  }
  {
    const page = await openEmbed(isolated)
    const frame = page.frameLocator('#embed')
    try {
      await page.evaluate((source) => window.send('run', source), language)
      await frame.locator('.console').getByText('(Keine Ausgabe)').waitFor({ timeout: 60000 })
      await enterRepl(frame, 'repl()')
      // The input line takes the focus (and keeps the >>> line's).
      await programLine(frame).waitFor({ timeout: 30000 })
      assert.ok(await programLine(frame).evaluate((element) => element === document.activeElement), 'the input line has the focus')
      await answer(frame, '1 + 2')
      await answer(frame, '2 * (3 + 4)')
      await answer(frame, 'ende')
      await frame.locator('.repl-line:not(.repl-line--program)').waitFor({ timeout: 30000 })
      assert.match(await consoleText(frame), />>> repl\(\)\n> 1 \+ 2\n3\n> 2 \* \(3 \+ 4\)\n14\n> ende/, 'transcript of the recursive REPL')
      console.log('input(): a recursive REPL in the console: ok')

      // Stop while it waits: EOFError, Python keeps its session.
      await enterRepl(frame, 'repl()')
      await answer(frame, '5 * 5')
      await programLine(frame).waitFor({ timeout: 30000 })
      await page.evaluate(() => document.querySelector('#embed').contentWindow.postMessage({ type: 'glpython:stop', version: 4 }, location.origin))
      await frame.locator('.repl-line:not(.repl-line--program)').waitFor({ timeout: 30000 })
      const stopped = await consoleText(frame)
      assert.match(stopped, /> 5 \* 5\n25\n> \n[\s\S]*EOFError: EOF when reading a line/, 'Stop → EOFError after the prompt')
      assert.doesNotMatch(stopped, /Python wurde neu gestartet/, 'Stop while waiting does not restart Python')
      // Ctrl+D in the empty line does the same.
      await enterRepl(frame, 'input("Name: ")')
      await programLine(frame).waitFor({ timeout: 30000 })
      await programLine(frame).press('Control+d')
      await frame.locator('.repl-line:not(.repl-line--program)').waitFor({ timeout: 30000 })
      // The error may arrive just after the line is back.
      await frame.locator('.console', { hasText: /Name: \n[\s\S]*EOFError/ }).waitFor({ timeout: 10000 }).catch(() => {})
      assert.match(await consoleText(frame), /Name: \n[\s\S]*EOFError/, 'Ctrl+D → EOFError')
      console.log('input(): Stop and Ctrl+D end the wait with EOFError: ok')

      // The visualizer asks while it records, then shows the steps.
      await page.evaluate((source) => window.send('visualize', source), 'text = input("> ")\nprint(eval(text))\n')
      await answer(frame, '2 * 3')
      await frame.locator('.visualizer-step-count').waitFor({ timeout: 60000 })
      await measured(frame)
      console.log('input(): the visualizer asks, then shows the steps: ok')
    } catch (error) {
      failed += 1
      console.error(error.message)
      console.error('console:', JSON.stringify(await consoleText(frame).catch(() => '?')))
    }
    await page.close()
  }
  // The visualizer (P39), in Ersetzung: indexing a named list is one step,
  // a named list passed to a call is still replaced by its value. A long
  // list is abbreviated in the step and in the variables, within the code's
  // width, and opens in full; an expression tree stays complete.
  {
    const page = await openEmbed({})
    const frame = page.frameLocator('#embed')
    const lines = () => frame.locator('.frame-box--root > .frame-code > .frame-line-row .frame-line').allInnerTexts()
    const stepButton = (index) => frame.locator('.visualizer-controls button').nth(index)
    try {
      await page.evaluate((source) => window.send('visualize', source), 'def notenschnitt(noten):\n    return sum(noten) / len(noten)\n\ndauer = [1, 2, 30]\nx = dauer[0] + dauer[1]\ny = [1, 2, 30][1]\nschnitt = notenschnitt(dauer)\n')
      await frame.locator('.visualizer-step-count').waitFor({ timeout: 60000 })
      await measured(frame)
      const seen = { 5: [], 6: [], 7: [] }
      while (!(await stepButton(2).isDisabled())) {
        await stepButton(2).click()
        const texts = await lines()
        for (const line of [5, 6, 7]) if (seen[line].at(-1) !== texts[line - 1]) seen[line].push(texts[line - 1])
      }
      assert.deepEqual(seen[5], ['x = dauer[0] + dauer[1]', 'x = 1 + dauer[1]', 'x = 1 + 2', 'x = 3'], 'dauer[0] + dauer[1]: one step per element')
      assert.deepEqual(seen[6], ['y = [1, 2, 30][1]', 'y = 2'], 'a list literal indexed directly')
      assert.ok(seen[7].includes('schnitt = notenschnitt([1, 2, 30])'), `a named list passed to a call: ${JSON.stringify(seen[7])}`)
      console.log('visualizer: a named list indexed in one step: ok')

      await page.evaluate((source) => window.send('visualize', source), 'l = list(range(1, 101))\nbaum = ["+", ["*", 2, ["-", 7, 3]], ["/", ["+", 1, 2], 3]]\n')
      await frame.locator('.visualizer-step-count').filter({ hasText: 'Vor der Ausführung' }).waitFor({ timeout: 60000 })
      await measured(frame)
      await stepButton(3).click()
      await frame.locator('.locals-row[data-name="baum"]').waitFor({ timeout: 30000 })
      const short = '[1, 2, 3, 4, 5, …, 100]'
      assert.equal((await lines())[0], `l = ${short}`, 'the step: abbreviated')
      const panelValue = frame.locator('.locals-row[data-name="l"] .locals-value')
      assert.equal(await panelValue.innerText(), short, 'the variables: the same abbreviation')
      assert.equal(await frame.locator('.locals-row[data-name="baum"] .locals-value').innerText(), "['+', ['*', 2, ['-', 7, 3]], ['/', ['+', 1, 2], 3]]", 'an expression tree: complete')
      const inline = frame.locator('.frame-box--root .visual-substituted-value.visual-value-more').first()
      const codeBox = await frame.locator('.frame-box--root > .frame-code').boundingBox()
      const valueBox = await inline.boundingBox()
      assert.ok(valueBox.x + valueBox.width <= codeBox.x + codeBox.width, 'the step value stays within the code')
      const full = `[${Array.from({ length: 100 }, (_, index) => index + 1).join(', ')}]`
      // A global variable: its box, on hover. A step's value: the dialog.
      const peek = await peekOf(frame, 'l')
      assert.equal(await peek.locator('.visualizer-globals-value-text').innerText(), full, 'the variables: the full value')
      assert.equal(await peek.locator('.locals-value-length').innerText(), '100 Werte', 'the variables: its length')
      await page.mouse.move(0, 0)
      await peek.waitFor({ state: 'detached', timeout: 5000 })
      for (const [label, target] of [['the step', inline]]) {
        await target.click()
        const dialog = frame.getByRole('dialog')
        assert.equal(await dialog.locator('.full-value-text').innerText(), full, `${label}: the full value`)
        assert.match(await dialog.locator('.input-dialog-heading').innerText(), /100 Werte/, `${label}: its length`)
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached', timeout: 5000 })
      }
      console.log('visualizer: a long list abbreviated, in full on request: ok')

      // P40: only the parts that change have steps, in both modes.
      const displays = 'baum = ["+", ["*", 2, ["-", 7, -3]], ["/", ["+", 1, 2], 3]]\nr = [-1, 2]\nx = [1 + 2, 3, 4]\na = 5\ny = [a, 2]\nn = 2\nw = ["+", 1, ["*", n, 3]]\n'
      for (const mode of ['Kasten', 'Ersetzung']) {
        await frame.locator('.visualizer-mode').getByRole('button', { name: mode }).click()
        await page.evaluate((source) => window.send('visualize', source), displays)
        await frame.locator('.visualizer-step-count').filter({ hasText: 'Vor der Ausführung' }).waitFor({ timeout: 60000 })
        await measured(frame)
        await frame.locator('.frame-box--root > .frame-code .frame-line').filter({ hasText: 'baum = ' }).waitFor({ timeout: 30000 })
        if (!(await stepButton(0).isDisabled())) await stepButton(0).click()
        await frame.locator('.visualizer-step-count').filter({ hasText: 'Vor der Ausführung' }).waitFor({ timeout: 5000 })
        const snapshot = async () => JSON.stringify([await lines(), await frame.locator('.locals-row').allInnerTexts()])
        const seen = { 1: [], 3: [], 5: [], 7: [] }
        let previous = await snapshot()
        let steps = 0
        while (!(await stepButton(2).isDisabled())) {
          await stepButton(2).click()
          steps += 1
          const current = await snapshot()
          assert.notEqual(current, previous, `${mode}, step ${steps}: something changes`)
          previous = current
          const texts = await lines()
          for (const line of [1, 3, 5, 7]) if (seen[line].at(-1) !== texts[line - 1]) seen[line].push(texts[line - 1])
        }
        assert.equal(steps, 10, `${mode}: seven assignments and three substitutions`)
        assert.deepEqual(seen[1], ['baum = ["+", ["*", 2, ["-", 7, -3]], ["/", ["+", 1, 2], 3]]'], `${mode}: the literal tree`)
        assert.ok(seen[3].includes('x = [3, 3, 4]'), `${mode}: [1 + 2, 3, 4]: ${JSON.stringify(seen[3])}`)
        assert.ok(seen[5].includes('y = [5, 2]'), `${mode}: [a, 2]: ${JSON.stringify(seen[5])}`)
        assert.ok(seen[7].includes('w = ["+", 1, ["*", 2, 3]]'), `${mode}: the tree with n: ${JSON.stringify(seen[7])}`)
      }
      console.log('visualizer: a display of literals has no steps: ok')
    } catch (error) {
      failed += 1
      console.error(error.message)
    }
    await page.close()
  }
  // listtree (P34): trees in the variables, the dialog and the REPL - and
  // without the feature, none of it.
  for (const query of ['?features=run,repl,visualize,listtree', '']) {
    const label = query ? 'listtree' : 'listtree: not without it in features'
    const page = await openEmbed({}, query)
    const frame = page.frameLocator('#embed')
    try {
      await page.evaluate((source) => window.send('visualize', source), 'baum = ["+", ["var", "x"], ["f", 1, 2]]\ngross = ["+", ["*", 2, ["-", 7, 3]], ["/", ["+", 1, 2], ["liste", "anna", "ben", "carla", 12345]]]\nnamen = ["Anna", "Ben"]\n')
      await frame.locator('.visualizer-step-count').waitFor({ timeout: 60000 })
      await measured(frame)
      await frame.locator('.visualizer-controls button').nth(3).click()
      await frame.locator('.locals-row[data-name="namen"]').waitFor({ timeout: 30000 })
      // The trees of global variables are in their boxes (P53).
      const treeOf = (_name) => frame.locator('.visualizer-globals-peek .value-tree')
      const parts = (tree) => tree.locator('.value-tree-node, .value-tree-leaf').allInnerTexts()
      await frame.getByRole('button', { name: 'Optionen' }).click()
      const toggle = frame.getByRole('menuitemcheckbox', { name: 'Listen als Baum zeigen' })
      if (!query) {
        assert.equal(await frame.locator('.value-tree, .locals-tree').count(), 0, 'no trees')
        assert.equal(await toggle.count(), 0, 'no switch')
      } else {
        await page.keyboard.press('Escape')
        const peek = await peekOf(frame, 'baum')
        assert.deepEqual(await parts(treeOf('baum')), ['+', 'var', "'x'", 'f', '1', '2'], 'the tree, labels without quotes')
        assert.equal(await peek.locator('.value-tree-scroll').getAttribute('aria-label'), "['+', ['var', 'x'], ['f', 1, 2]]", 'its text alternative')
        assert.equal(await frame.locator('.locals-row[data-name="baum"] .locals-value').innerText(), "['+', ['var', 'x'], ['f', 1, 2]]", 'the text stays')
        // No two nodes overlap; each child is below its parent; the tree
        // stays within the box.
        const boxes = await treeOf('baum').locator('.value-tree-node, .value-tree-leaf').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
        for (const [index, a] of boxes.entries()) for (const b of boxes.slice(index + 1)) assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, `nodes overlap: ${JSON.stringify([a, b])}`)
        assert.ok(boxes[1].top > boxes[0].bottom, 'a child below its parent')
        const peekBox = await peek.boundingBox()
        assert.ok(Math.max(...boxes.map((box) => box.right)) <= peekBox.x + peekBox.width, 'within the box')
        await peekOf(frame, 'namen')
        assert.deepEqual(await parts(treeOf('namen')), ['Anna', "'Ben'"], 'a list of names reads as a tree too')
        await peekOf(frame, 'gross')
        assert.ok((await parts(treeOf('gross'))).includes('liste'), 'a wide tree: in the box too')
        await page.mouse.move(0, 0)
        await peek.waitFor({ state: 'detached', timeout: 5000 })
        // The switch.
        await frame.getByRole('button', { name: 'Optionen' }).click()
        await toggle.click()
        await page.keyboard.press('Escape')
        await peekOf(frame, 'baum')
        assert.equal(await treeOf('baum').count(), 0, 'switched off: no tree')
        await page.mouse.move(0, 0)
        await peek.waitFor({ state: 'detached', timeout: 5000 })
        await frame.getByRole('button', { name: 'Optionen' }).click()
        if (!(await toggle.isVisible())) await frame.getByRole('button', { name: 'Optionen' }).click()
        await toggle.click()
        await page.keyboard.press('Escape')
        await peekOf(frame, 'baum')
        await treeOf('baum').waitFor({ timeout: 5000 })
        await page.mouse.move(0, 0)
      }
      // The REPL: a «Baum» button for a value that reads as a tree.
      await frame.locator('.visualizer-exit').click()
      await page.evaluate((source) => window.send('run', source), 'def parse(text):\n    return ["+", 2, ["*", 3, 4]]\n')
      await frame.locator('.console').getByText('(Keine Ausgabe)').waitFor({ timeout: 60000 })
      await enterRepl(frame, 'parse("2 + 3 * 4")')
      await frame.locator('.repl-value').getByText("['+', 2, ['*', 3, 4]]").waitFor({ timeout: 30000 })
      const button = frame.getByRole('button', { name: 'Baum: parse("2 + 3 * 4")' })
      if (!query) {
        assert.equal(await button.count(), 0, 'no «Baum» in the REPL')
      } else {
        assert.equal(await button.getAttribute('aria-pressed'), 'false', 'closed at first')
        await button.click()
        assert.deepEqual(await parts(frame.locator('.repl-tree .value-tree')), ['+', '2', '*', '3', '4'], 'the REPL value as a tree')
        await button.click()
        assert.equal(await frame.locator('.repl-tree').count(), 0, 'closed again')
        await enterRepl(frame, '[1, 2]')
        await frame.locator('.repl-value').getByText('[1, 2]', { exact: true }).waitFor({ timeout: 30000 })
        assert.equal(await frame.getByRole('button', { name: 'Baum: [1, 2]' }).count(), 0, 'no «Baum» for a list that is no tree')
      }
      console.log(`${label}: ok`)
    } catch (error) {
      failed += 1
      console.error(`${label}: ${error.message}`)
    }
    await page.close()
  }
  // The layout of trees as they come from a parser, and of uneven ones: no
  // two nodes overlap, siblings in order from left to right, each parent
  // above its children and centred over them (over the span from its first
  // child's left edge to its last child's right edge, as d3-flextree does).
  const treeProblems = (tree) => tree.evaluate((element) => {
    const boxes = new Map([...element.querySelectorAll('[data-tree-key]')].map((node) => [node.dataset.treeKey, node.getBoundingClientRect()]))
    const problems = []
    const entries = [...boxes]
    for (const [index, [keyA, a]] of entries.entries()) for (const [keyB, b] of entries.slice(index + 1)) if (!(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)) problems.push(`${keyA} overlaps ${keyB}`)
    for (const [key, box] of boxes) {
      const children = []
      for (let index = 0; boxes.has(key === '' ? String(index) : `${key}.${index}`); index++) children.push(boxes.get(key === '' ? String(index) : `${key}.${index}`))
      if (children.length === 0) continue
      for (const [index, child] of children.entries()) {
        if (child.top <= box.bottom) problems.push(`child ${index} of "${key}" not below it`)
        if (index > 0 && child.left < children[index - 1].right) problems.push(`child ${index} of "${key}" not right of its sibling`)
      }
      const middle = (children[0].left + children.at(-1).right) / 2
      if (Math.abs((box.left + box.right) / 2 - middle) > 1) problems.push(`"${key}" not centred over its children`)
    }
    return problems
  })
  const layoutTrees = [
    ['breit', "['f', ['g', 'erstes', 'zweites'], ['h', 'drittes', 'viertes'], ['k', 'fünftes']]"],
    ['2 + 3 * 4', "['+', 2, ['*', 3, 4]]"],
    ['(2 + 3) * 4', "['*', ['+', 2, 3], 4]"],
    ['-(1 + 2)', "['-', ['+', 1, 2]]"],
    ['x + 1', "['+', ['var', 'x'], 1]"],
    ['f(1, 2)', "['f', 1, 2]"],
    ['uneven, both sides', "['+', ['*', 2, ['-', 7, 3]], ['/', ['+', 1, 2], 3]]"],
    ['uneven, to the left', "['+', ['+', ['+', 1, 2], 3], ['f', ['var', 'x']]]"],
  ]
  {
    const page = await openEmbed({}, '?features=run,repl,visualize,listtree')
    const frame = page.frameLocator('#embed')
    try {
      await page.evaluate((source) => window.send('run', source), 'pass\n')
      await frame.locator('.console').getByText('(Keine Ausgabe)').waitFor({ timeout: 60000 })
      for (const [name, value] of layoutTrees) {
        await enterRepl(frame, value)
        await frame.getByRole('button', { name: `Baum: ${value}` }).click()
        const tree = frame.locator('.repl-tree .value-tree').last()
        assert.deepEqual(await treeProblems(tree), [], `the layout of ${name}`)
      }
      console.log('listtree: the layout: ok')
    } catch (error) {
      failed += 1
      console.error(`listtree: the layout: ${error.message}`)
    }
    await page.close()
  }
  // Narrow (420px): a tree wider than the console or the dialog starts with
  // its root in the middle, hints where more is hidden, and the keyboard
  // scrolls it (Home, End, arrows), the hints following.
  {
    const page = await openEmbed({}, '?features=run,repl,visualize,listtree', 420)
    const frame = page.frameLocator('#embed')
    const breit = layoutTrees[0][1]
    const checkNarrow = async (where, scroll) => {
      const state = () => scroll.evaluate((view) => {
        const root = view.querySelector('[data-tree-key=""]').getBoundingClientRect()
        const box = view.getBoundingClientRect()
        const hints = [...view.parentElement.querySelectorAll('.value-tree-hint')].map((hint) => hint.classList.contains('value-tree-hint--left') ? 'left' : 'right')
        return { offCentre: Math.abs((root.left + root.right) / 2 - (box.left + box.width / 2)), wider: view.scrollWidth > view.clientWidth, scrollLeft: view.scrollLeft, hints, focusable: view.tabIndex === 0 }
      })
      const first = await state()
      assert.ok(first.wider, `${where}: wider than its place`)
      assert.ok(first.offCentre <= 2, `${where}: the root in the middle (${first.offCentre}px off)`)
      assert.deepEqual(first.hints, ['left', 'right'], `${where}: a hint at both edges`)
      assert.ok(first.focusable, `${where}: takes the focus`)
      // A hint isn't a node: no border, over the tree's whole height, in a
      // colour of none of the nodes.
      const look = await scroll.evaluate((view) => {
        const box = view.getBoundingClientRect()
        const nodeColours = new Set([...view.querySelectorAll('[data-tree-key]')].map((node) => getComputedStyle(node).color))
        return [...view.parentElement.querySelectorAll('.value-tree-hint')].map((hint) => {
          const style = getComputedStyle(hint)
          const rect = hint.getBoundingClientRect()
          return { border: style.borderTopStyle, fullHeight: Math.abs(rect.top - box.top) <= 1 && Math.abs(rect.bottom - box.bottom) <= 1, ownColour: !nodeColours.has(style.color) }
        })
      })
      assert.deepEqual(look, [{ border: 'none', fullHeight: true, ownColour: true }, { border: 'none', fullHeight: true, ownColour: true }], `${where}: the hints don't look like nodes`)
      await scroll.focus()
      await scroll.press('Home')
      await frame.locator('.value-tree-hint--left').waitFor({ state: 'detached', timeout: 5000 })
      assert.deepEqual((await state()).hints, ['right'], `${where}: at the left end, the right hint only`)
      await scroll.press('ArrowRight')
      assert.ok((await state()).scrollLeft > 0, `${where}: → scrolls`)
      await scroll.press('End')
      await frame.locator('.value-tree-hint--right').waitFor({ state: 'detached', timeout: 5000 })
      assert.deepEqual((await state()).hints, ['left'], `${where}: at the right end, the left hint only`)
    }
    try {
      await page.evaluate((source) => window.send('run', source), `breit = ${breit}\n`)
      await frame.locator('.console').getByText('(Keine Ausgabe)').waitFor({ timeout: 60000 })
      await enterRepl(frame, 'breit')
      await frame.getByRole('button', { name: 'Baum: breit' }).click()
      await checkNarrow('the console', frame.locator('.repl-tree .value-tree-scroll'))
      await page.evaluate((source) => window.send('visualize', source), `breit = ${breit}\n`)
      await frame.locator('.visualizer-step-count').waitFor({ timeout: 60000 })
      await measured(frame)
      await frame.locator('.visualizer-controls button').nth(3).click()
      await checkNarrow('the box', (await peekOf(frame, 'breit')).locator('.value-tree-scroll'))
      console.log('listtree: narrow: ok')
    } catch (error) {
      failed += 1
      console.error(`listtree: narrow: ${error.message}`)
    }
    await page.close()
  }
  // Lists as trees in call boxes (P56): in «Kasten» and «Baum», a box's row
  // is one line - a list that reads as a tree is dotted and opens its tree
  // over the code on hover or focus, like the footer's entries. The arrow
  // from the name in the code still ends at the line; opening the tree
  // changes no height; a list that isn't a tree has no hint.
  for (const mode of ['box', 'tree']) {
    const label = `listtree: trees in call boxes, ${mode === 'box' ? 'Kasten' : 'Baum'}`
    const page = await openEmbed({}, `?features=run,repl,visualize,listtree,tree&visualizer=${mode}`)
    const frame = page.frameLocator('#embed')
    try {
      const program = `def ist_ausgewertet(baum):\n    return isinstance(baum, int)\n\ndef auswerten(baum):\n    if ist_ausgewertet(baum):\n        return baum\n    op = baum[0]\n    links = auswerten(baum[1])\n    rechts = auswerten(baum[2])\n    if op == '+':\n        return links + rechts\n    return links * rechts\n\ndef summe(zahlen):\n    ergebnis = zahlen[0] + zahlen[1] + zahlen[2]\n    return ergebnis\n\nauswerten(['+', 2, ['*', 3, 4]])\nsumme([1, 2, 3])\n`
      await page.evaluate((source) => window.send('visualize', source), program)
      await frame.locator('.visualizer-step-count').filter({ hasText: 'Vor der Ausführung' }).waitFor({ timeout: 60000 })
      await measured(frame)
      // The deepest call of auswerten: the most boxes.
      const next = frame.locator('.visualizer-controls button').nth(2)
      const boxes = () => frame.locator('.frame-box[data-frame-id]').count()
      let deepest = { boxes: 0, step: 0 }
      for (let step = 1; await next.isEnabled() && step < 200; step++) {
        await next.click()
        const count = await boxes()
        if (count > deepest.boxes) deepest = { boxes: count, step }
      }
      await frame.locator('.visualizer-controls button').nth(0).click()
      for (let step = 0; step < deepest.step; step++) await next.click()
      const rows = await frame.locator('.visualizer-canvas').evaluate(async (canvas) => {
        await Promise.all(canvas.ownerDocument.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})))
        return [...canvas.querySelectorAll('.frame-vars')].map((row) => ({ height: row.getBoundingClientRect().height, trees: row.querySelectorAll('.value-tree').length }))
      })
      const lineHeight = Math.min(...rows.map((row) => row.height))
      assert.ok(rows.length >= 3 && rows.every((row) => row.trees === 0 && row.height <= lineHeight + 1), `every row one line: ${JSON.stringify(rows)}`)
      const triggers = frame.locator('.visualizer-canvas .locals-value--tree')
      // The inner box's row comes first: it is inside the outer box's code.
      assert.deepEqual(await triggers.allInnerTexts(), ["['*', 3, 4]", "['+', 2, ['*', 3, 4]]"], 'the lists that read as a tree, dotted')
      const reported = await page.evaluate(() => window.reported.height)
      for (const [index, parts] of [[0, ['*', '3', '4']], [1, ['+', '2', '*', '3', '4']]]) {
        await page.mouse.move(0, 0)
        await frame.locator('.visualizer-tree-peek').waitFor({ state: 'detached', timeout: 5000 })
        await triggers.nth(index).hover()
        const peek = frame.locator('.visualizer-tree-peek')
        await peek.locator('.value-tree').waitFor({ timeout: 3000 })
        assert.deepEqual(await peek.locator('.value-tree-node, .value-tree-leaf').allInnerTexts(), parts, `the tree of box ${index + 1}`)
        const inside = await peek.evaluate((element) => { const box = element.getBoundingClientRect(); const bounds = element.closest('.visualizer-frame').getBoundingClientRect(); return box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1 })
        assert.ok(inside, 'inside the visualizer')
        // Only the tree: the line below already gives name, length and text.
        assert.equal(await peek.locator('.locals-name, .locals-value-length, .visualizer-globals-value-text').count(), 0, 'only the tree in the box')
        assert.equal(await triggers.nth(index).getAttribute('title'), null, 'no tooltip')
        const description = await triggers.nth(index).evaluate((element) => element.getAttribute('aria-describedby').split(' ').map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '').join(' '))
        assert.ok(description.startsWith('Baum zeigen'), `the label for screen readers: ${description}`)
      }
      await page.waitForTimeout(300)
      assert.equal(await page.evaluate(() => window.reported.height), reported, 'the open tree changes no height')
      // The keyboard: focus opens it.
      await page.mouse.move(0, 0)
      await frame.locator('.visualizer-tree-peek').waitFor({ state: 'detached', timeout: 5000 })
      await triggers.nth(1).focus()
      await frame.locator('.visualizer-tree-peek').waitFor({ timeout: 3000 })
      await triggers.nth(1).blur()
      // The arrow from baum in ist_ausgewertet's call ends at a row's line.
      const ends = await frame.locator('.visualizer-canvas').evaluate((canvas) => [...canvas.querySelectorAll('.visualizer-connectors > path')].flatMap((arrow) => [0, arrow.getTotalLength()].map((at) => arrow.getPointAtLength(at))).map((point) => ({ x: point.x, y: point.y })))
      const lines = await frame.locator('.visualizer-canvas').evaluate((canvas) => { const origin = canvas.getBoundingClientRect(); return [...canvas.querySelectorAll('.frame-vars .locals-value')].map((value) => { const box = value.getBoundingClientRect(); return { left: box.left - origin.left, right: box.right - origin.left, top: box.top - origin.top, bottom: box.bottom - origin.top } }) })
      if (ends.length > 0) assert.ok(ends.some((point) => lines.some((line) => point.x >= line.left - 2 && point.x <= line.right + 2 && point.y >= line.top - 2 && point.y <= line.bottom + 2)), `an arrow ends at a row's line: ${JSON.stringify({ ends, lines })}`)
      // summe([1, 2, 3]) (a box: it has a local variable): a list, but not a
      // tree - its line, no hint.
      const zahlen = frame.locator('.frame-box .locals-row[data-name="zahlen"] .locals-value')
      while (await next.isEnabled() && (await zahlen.count() === 0 || await zahlen.innerText() === '\u2026')) await next.click()
      assert.equal(await frame.locator('.locals-row[data-name="zahlen"] .locals-value').innerText(), '[1, 2, 3]', 'the list [1, 2, 3]')
      assert.equal(await frame.locator('.locals-row[data-name="zahlen"] .locals-value--tree').count(), 0, 'no hint on [1, 2, 3]')
      console.log(`${label}: ok`)
    } catch (error) {
      failed += 1
      console.error(`${label}: ${error.message}`)
    }
    await page.close()
  }
  // A call box flies in from its function's entry in the footer (P57): its
  // first frame is centred on that entry, also for a box inside a box that
  // flew in itself (custom properties are inherited: such a box used to
  // start from its caller's offset), at two widths. While the view scrolls
  // after the step, the box stays on the line from the entry to where it is
  // now (the scroll used to drag its path along). With reduced motion
  // nothing moves: the box only fades in, the view doesn't glide, and the
  // parameters' arrows still come.
  {
    const evaluator = `from parser import ist_liste\n\ndef ist_ausgewertet(baum):\n    if ist_liste(baum):\n        return False\n    else:\n        return True\n\ndef operator_anwenden(op, x, y):\n    if op == "+":\n        return x + y\n    if op == "*":\n        return x * y\n\ndef auswerten(baum):\n    if ist_ausgewertet(baum):\n        return baum\n    return operator_anwenden(baum[0], auswerten(baum[1]), auswerten(baum[2]))\n\nauswerten(['+', 2, ['*', 3, 4]])\n`
    const files = [{ path: 'main.py', source: evaluator }, { path: 'parser.py', source: 'def ist_liste(x):\n    return isinstance(x, list)\n' }]
    for (const [width, cap, reduced] of [[760, 700, false], [480, 500, false], [760, 700, true]]) {
      const label = `call boxes fly in from the footer, ${width}px${reduced ? ', reduced motion' : ''}`
      const page = await openEmbed({}, `?features=visualize,listtree,tree&visualizer=box&cap=${cap}`, width)
      if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' })
      const frame = page.frameLocator('#embed')
      try {
        await page.evaluate((files) => document.querySelector('#embed').contentWindow.postMessage({ type: 'glpython:visualize', version: 4, source: files[0].source, files, mainFile: 'main.py', mode: 'eval' }, location.origin), files)
        await frame.locator('.visualizer-step-count').filter({ hasText: 'Vor der Ausführung' }).waitFor({ timeout: 60000 })
        await measured(frame)
        const child = page.frames()[1]
        const next = frame.locator('.visualizer-controls button').nth(2)
        const flights = []
        for (let step = 1; await next.isEnabled() && step < 200; step++) {
          // Follow the box that opens with this step, frame by frame (after
          // each frame's animation callbacks: as drawn): where it is, where it
          // would be without its transform, and the entry of its function in
          // the footer, all in the frame's coordinates.
          await child.evaluate(() => {
            for (const box of document.querySelectorAll('.frame-box[data-frame-id]')) box.dataset.seen = ''
            window.flyIn = null
            const view = document.querySelector('.visualizer-view')
            let frames = 0
            const look = () => {
              const box = document.querySelector('.frame-box[data-frame-id]:not([data-seen])')
              if (!box) { if (++frames < 60) requestAnimationFrame(look); return }
              const bounds = () => document.querySelector('.visualizer-frame').getBoundingClientRect()
              const centre = (rect, f) => [rect.left - f.left + rect.width / 2, rect.top - f.top + rect.height / 2]
              const name = /def (\w+)\(/.exec(box.textContent)?.[1]
              const entry = document.querySelector(`.visualizer-globals .locals-row[data-name="${name}"] .locals-value`)
              const origin = centre(entry.getBoundingClientRect(), bounds())
              const flyIn = window.flyIn = { name, origin, start: centre(box.getBoundingClientRect(), bounds()), offLine: 0, scrolled: 0, moved: false, opacity: Number(getComputedStyle(box).opacity), scroll: [view.scrollLeft, view.scrollTop], positions: [`${view.scrollLeft},${view.scrollTop}`], arrows: 0, frames: [] }
              const begun = performance.now()
              const track = () => {
                const f = bounds()
                const at = centre(box.getBoundingClientRect(), f)
                const matrix = new DOMMatrix(getComputedStyle(box).transform)
                if (Math.abs(matrix.e) > 0.5 || Math.abs(matrix.f) > 0.5 || Math.abs(matrix.a - 1) > 0.01) flyIn.moved = true
                const rest = [at[0] - matrix.e, at[1] - matrix.f]
                const a = [at[0] - origin[0], at[1] - origin[1]]
                const b = [rest[0] - origin[0], rest[1] - origin[1]]
                const length = Math.hypot(b[0], b[1])
                flyIn.frames.push([Math.round(performance.now() - begun), ...at.map(Math.round), ...rest.map(Math.round), view.scrollLeft, view.scrollTop, ...centre(entry.getBoundingClientRect(), f).map(Math.round), Math.round(f.height), box.style.getPropertyValue('--grow-dx'), box.style.getPropertyValue('--grow-dy')].join(' '))
                if (length > 1) flyIn.offLine = Math.max(flyIn.offLine, Math.abs(a[0] * b[1] - a[1] * b[0]) / length)
                const position = `${view.scrollLeft},${view.scrollTop}`
                if (flyIn.positions.at(-1) !== position) flyIn.positions.push(position)
                flyIn.scrolled = Math.max(flyIn.scrolled, Math.abs(view.scrollLeft - flyIn.scroll[0]) + Math.abs(view.scrollTop - flyIn.scroll[1]))
                if (performance.now() - begun < 450) requestAnimationFrame(() => setTimeout(track))
                else flyIn.arrows = document.querySelectorAll('svg.visualizer-connectors > path').length
              }
              requestAnimationFrame(() => setTimeout(track))
            }
            requestAnimationFrame(look)
          })
          await next.click()
          await page.waitForTimeout(650)
          const flyIn = await child.evaluate(() => window.flyIn)
          if (flyIn) flights.push({ step, ...flyIn })
        }
        assert.ok(flights.length >= 10, `the boxes that open: ${flights.length}`)
        const at = (flight) => `step ${flight.step}, ${flight.name}`
        if (reduced) {
          for (const flight of flights) {
            assert.ok(!flight.moved, `${at(flight)}: no movement`)
            assert.ok(flight.opacity < 1, `${at(flight)}: it fades in (opacity ${flight.opacity})`)
            assert.ok(flight.positions.length <= 2, `${at(flight)}: the view jumps to its place, doesn't glide: ${flight.positions.join(' → ')}`)
            assert.ok(flight.arrows > 0, `${at(flight)}: the parameters' arrows`)
          }
        } else {
          for (const flight of flights) {
            assert.ok(Math.hypot(flight.start[0] - flight.origin[0], flight.start[1] - flight.origin[1]) <= 2, `${at(flight)}: starts at its entry in the footer: ${flight.start} vs ${flight.origin}`)
            assert.ok(flight.offLine <= 3, `${at(flight)}: stays on its line while the view scrolls (${Math.round(flight.offLine)}px off; t at rest scroll entry height dx dy: ${flight.frames.join(' | ')})`)
            assert.ok(flight.arrows > 0, `${at(flight)}: the parameters' arrows`)
          }
          if (width === 480) assert.ok(flights.some((flight) => flight.scrolled > 100), 'the view scrolls during a fly-in')
        }
        console.log(`${label}: ok`)
      } catch (error) {
        failed += 1
        console.error(`${label}: ${error.message}`)
      }
      await page.close()
    }
  }
  // The global variables (P53): in a footer below the code that doesn't
  // scroll with it; the arrow from a call to a global function ends at its
  // entry there, also with the current line at the bottom of a long
  // program; hovering opens the definition, highlighted, inside the
  // visualizer. The current call's box, taller than the view, keeps its
  // variable row in sight above the footer. No footer without globals.
  {
    const label = 'global variables in the footer'
    const page = await openEmbed({}, '?visualizer=box&cap=600')
    const frame = page.frameLocator('#embed')
    try {
      const body = Array.from({ length: 30 }, (_, index) => `    s = s + ${index}`).join('\n')
      await page.evaluate((source) => window.send('visualize', source), `def lang(n):\n    s = n\n${body}\n    return s\n\n${'\n'.repeat(20)}x = lang(1)\n`)
      await frame.locator('.visualizer-step-count').waitFor({ timeout: 60000 })
      await measured(frame)
      const next = frame.locator('.visualizer-controls button').nth(2)
      const geometry = () => frame.locator('.visualizer-frame').evaluate(async (box) => {
        await Promise.all(box.ownerDocument.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})))
        const rect = (element) => element?.getBoundingClientRect().toJSON() ?? null
        const frameRect = box.getBoundingClientRect()
        const ends = [...box.querySelectorAll('.visualizer-connectors--frame > path')].flatMap((arrow) => [0, arrow.getTotalLength()].map((at) => { const point = arrow.getPointAtLength(at); return { x: point.x + frameRect.left, y: point.y + frameRect.top } }))
        return { frame: rect(box), view: rect(box.querySelector('.visualizer-view')), footer: rect(box.querySelector('.visualizer-globals')), entry: rect(box.querySelector('.visualizer-globals-list > .locals-row[data-name="lang"]')), arrowEnds: ends, sticky: rect(box.querySelector('.frame-box--current > .frame-vars')) }
      })
      // Until the call of lang is about to be looked up: its arrow.
      let state = await geometry()
      const atEntry = ({ arrowEnds, entry }) => arrowEnds.some((point) => point.y >= entry.top - 1 && point.y <= entry.bottom + 1 && point.x >= entry.left - 1 && point.x <= entry.right + 1)
      for (let steps = 0; !(state.entry && atEntry(state)) && steps < 5; steps++) { await next.click(); state = await geometry() }
      assert.ok(state.footer && state.footer.top >= state.view.bottom - 1 && state.footer.bottom <= state.frame.bottom + 1, 'the footer below the code, in the visualizer')
      assert.ok(atEntry(state), `an arrow from the entry of lang: ${JSON.stringify(state)}`)
      // The box of lang, taller than the view: its variables at the bottom.
      for (let steps = 0; !state.sticky && steps < 5; steps++) { await next.click(); state = await geometry() }
      assert.ok(state.sticky && state.sticky.bottom <= state.footer.top + 1 && state.sticky.bottom >= state.view.bottom - 2, `the current box's variables above the footer: ${JSON.stringify(state)}`)
      const peek = await peekOf(frame, 'lang')
      assert.match(await peek.innerText(), /^def lang\(n\):\n {4}s = n\n/, 'the definition')
      assert.ok(await peek.locator('.py-tok-keyword').count() >= 2, 'highlighted')
      const peekBox = await peek.boundingBox()
      const frameBox = await frame.locator('.visualizer-frame').boundingBox()
      assert.ok(peekBox.y >= frameBox.y - 1 && peekBox.x >= frameBox.x - 1 && peekBox.x + peekBox.width <= frameBox.x + frameBox.width + 1 && peekBox.height <= frameBox.height * 2 / 3 + 1, 'inside the visualizer, at most two thirds of its height')
      assert.ok(await peek.evaluate((element) => element.scrollHeight > element.clientHeight), 'a long definition scrolls')
      await page.mouse.move(0, 0)
      await peek.waitFor({ state: 'detached', timeout: 5000 })
      await page.evaluate((source) => window.send('visualize', source), 'print(1 + 2)\n')
      await frame.locator('.visualizer-step-count').filter({ hasText: 'Vor der Ausführung' }).waitFor({ timeout: 60000 })
      await measured(frame)
      assert.equal(await frame.locator('.visualizer-globals').count(), 0, 'no footer without globals')
      console.log(`${label}: ok`)
    } catch (error) {
      failed += 1
      console.error(`${label}: ${error.message}`)
    }
    await page.close()
  }
  // A steady height while stepping, in both modes: a recursion taller than
  // the cap (the embed at most 720px: its code scrolls) and a loop that
  // prints. The current line is always in the visualizer's view.
  for (const [label, mode, source] of [
    ['steady height: a recursion, Kasten', 'box', 'def fakultaet(n):\n    if n == 0:\n        return 1\n    return n * fakultaet(n - 1)\n\nprint(fakultaet(4))\n'],
    ['steady height: a recursion, Ersetzung', 'substitution', 'def fakultaet(n):\n    if n == 0:\n        return 1\n    return n * fakultaet(n - 1)\n\nprint(fakultaet(4))\n'],
    ['steady height: a loop that prints', 'substitution', 'for i in range(6):\n    print("Zeile", i)\n'],
  ]) {
    const page = await openEmbed({}, `?visualizer=${mode}&cap=720`)
    const frame = page.frameLocator('#embed')
    try {
      await page.evaluate((program) => window.send('visualize', program), source)
      await frame.locator('.visualizer-step-count').waitFor({ timeout: 60000 })
      await measured(frame)
      // Once the step's animations are over (a call box flies in from its
      // function's entry in the footer, below the code).
      const state = () => frame.locator('.embed-app').evaluate(async (app) => {
        await Promise.all(app.ownerDocument.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})))
        const view = app.querySelector('.visualizer-view')
        const line = view.querySelector('.visual-current-line')
        const box = view.getBoundingClientRect()
        const lineBox = line?.getBoundingClientRect()
        return { height: Math.round(app.getBoundingClientRect().height), view: Math.round(box.height), lineInView: !lineBox || (lineBox.top >= box.top - 1 && lineBox.bottom <= box.bottom + 1) }
      })
      const states = [await state()]
      const next = frame.locator('.visualizer-controls button').nth(2)
      while (await next.isEnabled()) {
        await next.click()
        await new Promise((resolve) => setTimeout(resolve, 50))
        states.push(await state())
      }
      assert.ok(states.length > 10, 'some steps')
      assert.deepEqual([...new Set(states.map((step) => step.height))], [states[0].height], 'one height for every step')
      assert.ok(Math.max(...states.map((step) => step.height)) <= 720, `the embed at most as tall as its iframe may be (${Math.max(...states.map((step) => step.height))}px)`)
      assert.deepEqual(states.map((step, index) => step.lineInView ? null : index).filter((index) => index !== null), [], 'the current line in view')
      console.log(`${label}: ok`)
    } catch (error) {
      failed += 1
      console.error(`${label}: ${error.message}`)
    }
    await page.close()
  }
  // The embed's height (P53b): it reports the height its content needs, also
  // while its iframe is smaller (the LiaScript macro caps it at 80% of the
  // course's visible height). Then the visualizer's code scrolls inside,
  // between the step bar and the footer, both in view, and the embed's own
  // page doesn't scroll; a larger cap lets it grow again. A short program
  // scrolls nothing; a long output scrolls the console.
  {
    const label = 'the embed\'s height'
    const page = await openEmbed({}, '?visualizer=box&cap=500')
    const frame = page.frameLocator('#embed')
    try {
      const recursion = 'def fakultaet(n):\n    if n == 0:\n        return 1\n    return n * fakultaet(n - 1)\n\nprint(fakultaet(5))\n'
      await page.evaluate((program) => window.send('visualize', program), recursion)
      await frame.locator('.visualizer-step-count').waitFor({ timeout: 60000 })
      await measured(frame)
      const last = frame.locator('.visualizer-controls button').nth(3)
      await last.click()
      const layout = async () => ({
        iframe: await page.locator('#embed').evaluate((iframe) => iframe.getBoundingClientRect().height),
        reported: await page.evaluate(() => window.reported),
        ...(await frame.locator('.embed-app').evaluate(async (app) => {
          await Promise.all(app.ownerDocument.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {})))
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const rect = (selector) => app.querySelector(selector)?.getBoundingClientRect().toJSON() ?? null
          const view = app.querySelector('.visualizer-view')
          const console = app.querySelector('.console')
          return { inner: innerHeight, pageScrolls: document.scrollingElement.scrollHeight > innerHeight + 1, bar: rect('.visualizer-bar'), footer: rect('.visualizer-globals'), view: view && { client: view.clientHeight, scroll: view.scrollHeight }, console: { client: console.clientHeight, scroll: console.scrollHeight } }
        })),
      })
      const settled = async (check) => {
        let state
        for (let tries = 0; tries < 20; tries++) {
          state = await layout()
          if (check(state)) return state
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        return state
      }
      let state = await settled((s) => s.iframe === 500)
      assert.equal(state.iframe, 500, `the iframe at the cap: ${JSON.stringify(state)}`)
      assert.ok(state.reported.visualizing === true && state.reported.height > 700, `the content's own height reported: ${JSON.stringify(state.reported)}`)
      assert.ok(state.view.scroll > state.view.client, 'the code scrolls')
      assert.ok(state.bar.top >= 0 && state.footer.bottom <= state.inner + 1 && !state.pageScrolls, `step bar and footer in view, the page doesn't scroll: ${JSON.stringify(state)}`)
      const current = await frame.locator('.visualizer-view').evaluate((view) => { const line = view.querySelector('.visual-current-line')?.getBoundingClientRect(); const box = view.getBoundingClientRect(); return !line || (line.top >= box.top - 1 && line.bottom <= box.bottom + 1) })
      assert.ok(current, 'the current line in view')
      const natural = state.reported.height
      await page.evaluate(() => window.setCap(3000))
      state = await settled((s) => s.iframe === natural)
      assert.ok(state.iframe === natural && state.reported.height === natural && state.view.scroll <= state.view.client + 1, `a larger cap: the whole content (${JSON.stringify(state)})`)
      await page.evaluate(() => window.setCap(400))
      state = await settled((s) => s.iframe === 400)
      assert.ok(state.iframe === 400 && state.reported.height === natural, `a smaller cap again: ${JSON.stringify(state)}`)
      await page.evaluate(() => window.setCap(900))
      await page.evaluate((program) => window.send('visualize', program), 'x = 1 + 2\nprint(x)\n')
      await frame.locator('.visualizer-step-count').filter({ hasText: 'Vor der Ausführung' }).waitFor({ timeout: 60000 })
      await measured(frame)
      state = await settled((s) => s.reported.height < 500 && s.iframe === s.reported.height)
      assert.ok(state.iframe === state.reported.height && state.view.scroll <= state.view.client + 1 && !state.pageScrolls, `a short program: as tall as it needs (${JSON.stringify(state)})`)
      await page.evaluate(() => window.setCap(400))
      await page.evaluate((program) => window.send('run', program), 'for i in range(60):\n    print(i)\n')
      await frame.locator('.console', { hasText: '59' }).waitFor({ timeout: 60000 })
      state = await settled((s) => s.reported.visualizing === false && s.reported.height > 400 && s.iframe === 400)
      assert.ok(state.iframe === 400 && state.reported.visualizing === false && state.console.scroll > state.console.client && !state.pageScrolls, `a long output scrolls the console: ${JSON.stringify(state)}`)
      console.log(`${label}: ok`)
    } catch (error) {
      failed += 1
      console.error(`${label}: ${error.message}`)
    }
    await page.close()
  }
  // The visualizer's mode «Baum» (P34 A): only with "tree" in features= -
  // without it no mode button, and a stored or preset «Baum» shows
  // «Ersetzung». With it, each example takes «Ersetzung»'s steps plus one to
  // open and one to close each tree; a reduction moves no node of the tree;
  // each tree is described by its text, step by step as the chain; the embed
  // keeps one height; and a call that stays a box says why, in «Ersetzung»
  // and in «Baum».
  {
    const page = await openEmbed({}, '?visualizer=tree')
    const frame = page.frameLocator('#embed')
    try {
      await page.evaluate((source) => window.send('visualize', source), 'x = 2 + 3 * 4\n')
      await measured(frame)
      assert.deepEqual(await frame.locator('.visualizer-mode button').allInnerTexts(), ['Kasten', 'Ersetzung'], 'the mode buttons')
      assert.equal(await frame.locator('.visualizer-mode button[aria-pressed="true"]').innerText(), 'Ersetzung', 'the mode shown')
      console.log('Baum: without "tree" no mode button: ok')
    } catch (error) {
      failed += 1
      console.error(`Baum: without "tree": ${error.message}`)
    }
    await page.close()
  }
  {
    const notenschnitt = 'def notenschnitt(noten):\n    summe = sum(noten)\n    anzahl = len(noten)\n    return summe / anzahl\n\nnotenschnitt([4, 5, 4.5])\n'
    const page = await openEmbed({}, '?features=visualize,tree')
    const frame = page.frameLocator('#embed')
    const stepCount = () => frame.locator('.visualizer-step-count').innerText()
    const mode = (name) => frame.locator('.visualizer-mode button', { hasText: name }).click()
    // A mode switch stays at the same point of the program, maybe already at
    // the last step.
    const lastStep = async () => {
      const button = frame.locator('.visualizer-controls button').nth(3)
      if (await button.isEnabled()) await button.click()
      return Number((await stepCount()).match(/von (\d+)/)[1])
    }
    for (const [label, source, ersetzung, trees, texts] of [
      ['2 + 3 * 4', 'x = 2 + 3 * 4\n', 3, 1, ['2 + 3 * 4', '2 + 12', '14']],
      ['(2 + 3) * 4', 'x = (2 + 3) * 4\n', 3, 1, ['(2 + 3) * 4', '5 * 4', '20']],
      ['quadrat(2 + 1)', 'def quadrat(x):\n    return x * x\n\ny = quadrat(2 + 1)\n', 5, 1, ['quadrat(2 + 1)', 'quadrat(3)', '3 * 3', '9']],
      ['notenschnitt([4, 5, 4.5])', notenschnitt, 13, 4, null],
    ]) {
      try {
        await page.evaluate((program) => window.send('visualize', program), source)
        await frame.locator('.visualizer-step-count', { hasText: 'Vor der' }).waitFor({ timeout: 60000 })
        await measured(frame)
        await mode('Ersetzung')
        assert.equal(await lastStep(), ersetzung, 'the steps of «Ersetzung»')
        await mode('Baum')
        await measured(frame)
        assert.equal(await lastStep(), ersetzung + 2 * trees, '«Ersetzung» plus open and close')
        await frame.locator('.visualizer-controls button').nth(0).click()
        const state = () => frame.locator('.embed-app').evaluate((app) => {
          const tree = app.querySelector('.visualizer-canvas > .frame-box > .frame-code .value-tree-scroll')
          return {
            height: Math.round(app.getBoundingClientRect().height),
            text: tree?.getAttribute('aria-label') ?? null,
            // Each node's centre (a value takes its subtree's place, whatever its width) and row.
            nodes: tree ? Object.fromEntries([...tree.querySelectorAll('[data-tree-key]')].map((node) => [node.dataset.treeKey, `${parseFloat(node.style.left) + parseFloat(node.style.width) / 2} ${node.style.top}`])) : null,
          }
        })
        const states = [await state()]
        const next = frame.locator('.visualizer-controls button').nth(2)
        while (await next.isEnabled()) {
          await next.click()
          states.push(await state())
        }
        assert.deepEqual([...new Set(states.map((step) => step.height))], [states[0].height], 'one height for every step')
        if (texts) assert.deepEqual(states.map((step) => step.text).filter((text, index, all) => text !== null && text !== all[index - 1]), texts, 'the tree described by its text, as the chain')
        // A reduction (no new node) leaves every node where it was.
        states.forEach((step, index) => {
          const before = states[index - 1]?.nodes
          if (!before || !step.nodes || !Object.keys(step.nodes).every((key) => key in before)) return
          for (const [key, place] of Object.entries(step.nodes)) assert.equal(place, before[key], `node ${key} moved at step ${index}`)
        })
        console.log(`Baum: ${label}: ok`)
      } catch (error) {
        failed += 1
        console.error(`Baum: ${label}: ${error.message}`)
      }
    }
    // P44: a call of the program's own labels its arguments' edges with the
    // parameters; a call that stays a box sits in its node's place. Every
    // step: one height, nothing overlapping, and positions that change only
    // where the box opens and closes.
    const callState = () => frame.locator('.embed-app').evaluate((app) => {
      const tree = app.querySelector('.visualizer-canvas > .frame-box > .frame-code .value-tree')
      if (!tree) return { height: Math.round(app.getBoundingClientRect().height), labels: null, nodes: null, overlap: null, box: null }
      const items = [...tree.querySelectorAll(':scope > [data-tree-key], :scope > .value-tree-edge-label')]
      const rects = items.map((item) => ({ name: item.dataset.treeKey ?? `label ${item.textContent}`, rect: (item.dataset.treeBoxKey ? item.firstElementChild ?? item : item).getBoundingClientRect() }))
      const overlap = rects.flatMap((a, i) => rects.slice(i + 1).filter((b) => a.rect.left < b.rect.right - 0.5 && b.rect.left < a.rect.right - 0.5 && a.rect.top < b.rect.bottom - 0.5 && b.rect.top < a.rect.bottom - 0.5).map((b) => `${a.name} / ${b.name}`))
      const box = tree.querySelector(':scope > [data-tree-box-key]')
      return {
        height: Math.round(app.getBoundingClientRect().height),
        labels: [...tree.querySelectorAll(':scope > .value-tree-edge-label')].map((label) => label.textContent),
        nodes: Object.fromEntries([...tree.querySelectorAll(':scope > [data-tree-key]')].map((node) => [node.dataset.treeKey, `${node.style.left} ${node.style.top}`])),
        overlap,
        box: box ? { top: box.style.top, besides: [...tree.querySelectorAll(':scope > [data-tree-key]:not([data-tree-box-key])')].filter((node) => node.style.top === box.style.top).map((node) => node.textContent) } : null,
      }
    })
    const allStates = async (program) => {
      await page.evaluate((source) => window.send('visualize', source), program)
      await frame.locator('.visualizer-step-count', { hasText: 'Vor der' }).waitFor({ timeout: 60000 })
      await measured(frame)
      await mode('Baum')
      await measured(frame)
      const first = frame.locator('.visualizer-controls button').nth(0)
      if (await first.isEnabled()) await first.click()
      const states = [await callState()]
      const next = frame.locator('.visualizer-controls button').nth(2)
      while (await next.isEnabled()) {
        await next.click()
        // After the step's animations (a box grows in, nodes glide).
        await new Promise((resolve) => setTimeout(resolve, 600))
        states.push(await callState())
      }
      return states
    }
    try {
      const states = await allStates('def summe(x, y):\n    return x + y\n\nsumme(2 + 2, 3 * 4)\nlen([1, 2]) + max(2, 5)\n')
      const labelled = states.map((state) => state.labels?.join(',') ?? null).filter((labels) => labels !== null).filter((labels, index, all) => labels !== all[index - 1])
      assert.deepEqual(labelled, ['x,y', '', ], 'x and y until the call is replaced, then none (nor for len and max)')
      assert.deepEqual(states.filter((state) => state.labels?.join(',') === 'x,y').length, 3, 'on the three steps before the call is replaced')
      assert.deepEqual(states.flatMap((state) => state.overlap ?? []), [], 'nothing overlaps')
      assert.deepEqual([...new Set(states.map((state) => state.height))], [states[0].height], 'one height')
      console.log('Baum: parameter names on the edges: ok')
    } catch (error) {
      failed += 1
      console.error(`Baum: parameter names on the edges: ${error.message}`)
    }
    try {
      const states = await allStates('def notenschnitt(noten):\n    summe = sum(noten)\n    anzahl = len(noten)\n    return summe / anzahl\n\nnotenschnitt([4, 5, 4.5]) + 1\n')
      const withBox = states.filter((state) => state.box)
      assert.ok(withBox.length > 10, `the box is open for ${withBox.length} steps`)
      assert.deepEqual([...new Set(withBox.map((state) => JSON.stringify(state.box)))], [JSON.stringify({ top: '2.8em', besides: ['1'] })], 'the box on the row below +, the leaf 1 beside it')
      assert.deepEqual([...new Set(withBox.map((state) => JSON.stringify(state.nodes)))].length, 1, 'nothing moves while the box is open')
      assert.deepEqual(states.flatMap((state) => state.overlap ?? []), [], 'nothing overlaps')
      assert.deepEqual([...new Set(states.map((state) => state.height))], [states[0].height], 'one height')
      console.log('Baum: the box in the call node\'s place: ok')
    } catch (error) {
      failed += 1
      console.error(`Baum: the box in the call node's place: ${error.message}`)
    }
    // The hint at a call that stays a box: in «Ersetzung», not in «Baum»
    // (the box in the call's place says it).
    for (const name of ['Ersetzung', 'Baum']) {
      try {
        await mode(name)
        await measured(frame)
        await frame.locator('.visualizer-controls button').nth(0).click()
        const next = frame.locator('.visualizer-controls button').nth(2)
        for (let index = 0; index < 6; index++) await next.click()
        // Not a closing box's fading copy (.visualizer-closing-boxes).
        const hint = frame.locator('.visualizer-view > .visualizer-canvas > .frame-box .frame-hint[data-box-reason="locals"]')
        if (name === 'Ersetzung') {
          await hint.waitFor({ timeout: 5000 })
          assert.equal(await hint.innerText(), 'notenschnitt hat lokale Variablen – der Aufruf wird als Kasten gezeigt.')
        } else {
          await frame.locator('.visualizer-view > .visualizer-canvas [data-tree-box-key] .frame-box').first().waitFor({ timeout: 5000 })
          assert.equal(await frame.locator('.visualizer-view > .visualizer-canvas .frame-hint').count(), 0, 'no hint in «Baum»')
        }
        assert.equal(await frame.locator('.visualizer-mode button', { hasText: name }).getAttribute('aria-pressed'), 'true')
        console.log(`Baum: the hint at the box in «${name}»${name === 'Baum' ? ': none' : ''}: ok`)
      } catch (error) {
        failed += 1
        console.error(`Baum: the hint in «${name}»: ${error.message}`)
      }
    }
    await page.close()
  }
  // P49: a call of the learner's own function that returns None shows None
  // as its last step - a line of the program, a REPL input, a failing
  // doctest example - in each mode; print(...) and xs.append(...) keep their
  // call text. The console prints nothing for None.
  {
    const anwenden = "def anwenden(op, x, y):\n    \"\"\"\n    >>> anwenden('*', 3, 4)\n    12\n    \"\"\"\n    if op == '+':\n        return x + y\n"
    const page = await openEmbed({}, '?features=run,repl,visualize,tests,tree')
    const frame = page.frameLocator('#embed')
    const mode = (name) => frame.locator('.visualizer-mode button', { hasText: name }).click()
    // The root box's code at each step, a tree as its text.
    const lines = () => frame.locator('.visualizer-view > .visualizer-canvas > .frame-box > .frame-code').evaluate((code) => {
      for (const tree of code.querySelectorAll('.value-tree-scroll')) tree.replaceWith(`[${tree.getAttribute('aria-label')}]`)
      return code.innerText
    })
    const steps = async () => {
      await measured(frame)
      const first = frame.locator('.visualizer-controls button').nth(0)
      if (await first.isEnabled()) await first.click()
      const seen = [await lines()]
      const next = frame.locator('.visualizer-controls button').nth(2)
      while (await next.isEnabled()) {
        await next.click()
        seen.push(await lines())
      }
      return seen
    }
    // The line of the root box's code that holds the call (the box's own
    // line numbers are separate lines of innerText).
    const lineOf = (text, call) => text.split('\n').find((line, index, all) => line === call || all[index - 1] === call)
    for (const name of ['Kasten', 'Ersetzung', 'Baum']) {
      try {
        await page.evaluate((source) => window.send('visualize', source), `${anwenden}\nxs = []\nanwenden('*', 3, 4)\nprint('x')\nxs.append(1)\n`)
        await frame.locator('.visualizer-step-count', { hasText: 'Vor der' }).waitFor({ timeout: 60000 })
        await mode(name)
        const seen = await steps()
        const last = seen.at(-1).split('\n')
        assert.equal(last[last.indexOf('10') + 1], 'None', 'a line of the program: anwenden(...) ends as None')
        assert.equal(last[last.indexOf('11') + 1], "print('x')", 'print(...) keeps its text')
        assert.equal(last[last.indexOf('12') + 1], 'xs.append(1)', 'xs.append(...) keeps its text')
        assert.ok(seen.every((text) => !text.includes('[None]')), 'no tree of None alone')

        await page.evaluate((source) => window.send('run', source), anwenden)
        await frame.locator('.console').getByText('(Keine Ausgabe)').waitFor({ timeout: 60000 })
        await enterRepl(frame, "anwenden('*', 3, 4)")
        const entry = frame.locator('.repl-entry').last()
        await entry.locator('.repl-entry-visualize:not([disabled])').waitFor({ timeout: 30000 })
        assert.equal(await entry.locator('.repl-value').count(), 0, 'the console shows nothing for None')
        assert.equal(await entry.innerText().then((text) => text.replace('Visualisieren', '').trim()), ">>> anwenden('*', 3, 4)", 'nothing printed')
        await entry.locator('.repl-entry-visualize').click()
        await mode(name)
        const repl = (await steps()).map((text) => lineOf(text, "anwenden('*', 3, 4)") ?? text)
        assert.equal(repl[0], "anwenden('*', 3, 4)", 'the REPL input starts as the call')
        assert.equal(repl.at(-1).split('\n').at(-1), 'None', 'the REPL input ends as None')

        await page.evaluate((source) => window.send('test', source), anwenden)
        await frame.getByRole('button', { name: 'Beispiel visualisieren' }).click()
        await frame.locator('.visualizer-step-count', { hasText: 'Vor der' }).waitFor({ timeout: 60000 })
        await mode(name)
        const example = await steps()
        // The call ends as None, the comparison below it.
        assert.deepEqual(example.at(-1).split('\n').slice(-2), ['None', 'Erhalten: (Keine Ausgabe) · Erwartet: 12'], 'the failing example ends as None')
        assert.equal(lineOf(example[0], "anwenden('*', 3, 4)"), "anwenden('*', 3, 4)", 'the example starts as the call')
        console.log(`None of an own call, «${name}»: a line, a REPL input, a doctest example: ok`)
      } catch (error) {
        failed += 1
        console.error(`None of an own call, «${name}»: ${error.message}`)
      }
    }
    await page.close()
  }
  // P37: the run file is __main__, in Pyodide too.
  {
    const page = await openEmbed({})
    const frame = page.frameLocator('#embed')
    try {
      await page.evaluate((source) => window.send('run', source), 'x = 2\nimport __main__\nprint("x ist", __main__.x)\nif __name__ == "__main__":\n    print("als Programm")\n')
      await frame.locator('.console').getByText('als Programm').waitFor({ timeout: 60000 })
      assert.match(await consoleText(frame), /x ist 2/, 'after a Run')
      await enterRepl(frame, 'y = 5')
      await enterRepl(frame, '__main__.y * 10')
      await frame.locator('.console').getByText('50', { exact: true }).waitFor({ timeout: 30000 })
      console.log('__main__: the run file and the REPL: ok')
    } catch (error) {
      failed += 1
      console.error(error.message)
      console.error('console:', JSON.stringify(await consoleText(frame).catch(() => '?')))
    }
    await page.close()
  }
  // Without isolation (as in LiaScript): Python's error and the hint.
  {
    const page = await openEmbed({})
    const frame = page.frameLocator('#embed')
    try {
      await page.evaluate((source) => window.send('run', source), 'x = input("> ")\n')
      await frame.locator('.console').getByText('RuntimeError: input() is not available here').waitFor({ timeout: 60000 })
      assert.match(await consoleText(frame), /`?input\(\)`? funktioniert hier nicht/, 'the hint')
      assert.equal(await frame.locator('.input-dialog').count(), 0, 'no dialog')
      console.log('input() without isolation: error and hint: ok')
    } catch (error) {
      failed += 1
      console.error(error.message)
    }
    await page.close()
  }
} finally {
  await browser.close()
  stopServer()
}
if (failed > 0) process.exit(1)
console.log(`jsDelivr: ${cdn.size} files fetched once, ${served - cdn.size} requests served from memory.`)
console.log('Console browser checks passed.')
