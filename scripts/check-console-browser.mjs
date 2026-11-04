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
// to the embed.
const harness = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<iframe id="embed" style="width:760px;height:900px;border:0"></iframe>
<script>
  const iframe = document.querySelector('#embed')
  window.ready = false
  window.send = (type, source) => iframe.contentWindow.postMessage({ type: 'glpython:' + type, version: 4, source, mode: 'eval' }, location.origin)
  addEventListener('message', (event) => { if (event.data?.type === 'glpython:ready') window.ready = true })
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
try {
  for (let attempt = 0; ; attempt++) {
    try { await fetch(`${origin}/index.html`); break } catch { if (attempt > 50) throw new Error('vite preview did not start') }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  for (const [label, first, second, firstSummary, secondSummary] of [
    ['Tests → fail → edit → Tests', failing, edited, '0 von 5 Beispielen bestanden', '1 von 5 Beispielen bestanden'],
    ['Tests → pass → edit → Tests', passing, passingEdited, '1 von 1 Beispielen bestanden', '2 von 2 Beispielen bestanden'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 800, height: 950 } })
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
  const page = await browser.newPage({ viewport: { width: 800, height: 950 } })
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
    const page = await browser.newPage({ viewport: { width: 800, height: 950 } })
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
  const openEmbed = async (headers) => {
    const page = await browser.newPage({ viewport: { width: 800, height: 950 } })
    await page.route((url) => url.pathname === '/check-console.html', (route) => route.fulfill({ contentType: 'text/html', body: harness, headers }))
    await page.goto(`${origin}/check-console.html`)
    await page.waitForFunction(() => window.ready, null, { timeout: 120000 })
    return page
  }
  const consoleText = (frame) => frame.locator('.console').innerText()
  const programLine = (frame) => frame.locator('.repl-line--program .repl-input')
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
      assert.match(await consoleText(frame), /Name: \n[\s\S]*EOFError/, 'Ctrl+D → EOFError')
      console.log('input(): Stop and Ctrl+D end the wait with EOFError: ok')

      // The visualizer asks while it records, then shows the steps.
      await page.evaluate((source) => window.send('visualize', source), 'text = input("> ")\nprint(eval(text))\n')
      await answer(frame, '2 * 3')
      await frame.locator('.visualizer-step-count').waitFor({ timeout: 60000 })
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
      await stepButton(3).click()
      await frame.locator('.locals-row[data-name="baum"]').waitFor({ timeout: 30000 })
      const short = '[1, 2, 3, 4, 5, …, 100]'
      assert.equal((await lines())[0], `l = ${short}`, 'the step: abbreviated')
      const panelValue = frame.locator('.locals-row[data-name="l"] .locals-value')
      assert.equal(await panelValue.locator('.visual-value-more-text').innerText(), short, 'the variables: the same abbreviation')
      assert.equal(await panelValue.locator('.locals-value-length').innerText(), '100 Werte', 'its length')
      assert.equal(await frame.locator('.locals-row[data-name="baum"] .locals-value').innerText(), "['+', ['*', 2, ['-', 7, 3]], ['/', ['+', 1, 2], 3]]", 'an expression tree: complete')
      const inline = frame.locator('.frame-box--root .visual-substituted-value.visual-value-more').first()
      const codeBox = await frame.locator('.frame-box--root > .frame-code').boundingBox()
      const valueBox = await inline.boundingBox()
      assert.ok(valueBox.x + valueBox.width <= codeBox.x + codeBox.width, 'the step value stays within the code')
      const full = `[${Array.from({ length: 100 }, (_, index) => index + 1).join(', ')}]`
      for (const [label, target] of [['the variables', panelValue], ['the step', inline]]) {
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
console.log('Console browser checks passed.')
