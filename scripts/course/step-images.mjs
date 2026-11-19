// The visualizer's steps as pictures (P71), for course material: the
// deployed IDE runs the file, visualizes the call and makes the zip with its
// own «Schritte als Bilder …» (P68) - the same pictures, names, size and
// pixel ratio as by hand. With --list the counter's step numbers and each
// step's text instead, to pick a range.
//
//   npm run step-images -- --file auswerter.py --call "auswerten(['-', 7, 2])" --mode box --from 3 --to 7 --out bilder.zip
//   npm run step-images -- --file auswerter.py --call "auswerten(['-', 7, 2])" --mode box --list
//     [--trees] [--lib parser.py …] [--ide live|dev]
//
// stderr: the IDE's version, and the zip written. Exit code 1 for a Python
// error, 2 for a wrong option or an IDE without the exporter.
import { writeFileSync } from 'node:fs'
import { callerPath, commonOptions, ideVersion, main, openVisualizer, parseArgs, UsageError } from './ide.mjs'

const usage = `npm run step-images -- --file <main.py> --call "<call>" (--list | --from <n> --to <n> --out <file.zip>) [--mode box|substitution] [--trees] [--lib <file.py> …] [--ide live|dev]`

await main(async () => {
  const argv = process.argv.slice(2)
  if (argv.includes('--help')) { console.log(usage); return }
  const options = parseArgs(argv, { flags: ['list', 'trees'], values: ['file', 'call', 'mode', 'ide', 'from', 'to', 'out'], repeat: ['lib'] })
  let settings
  try {
    settings = commonOptions(options)
    if (!options.list) {
      for (const name of ['from', 'to', 'out']) if (options[name] === undefined) throw new UsageError(`--${name} is missing (or --list)`)
      for (const name of ['from', 'to']) if (!/^\d+$/.test(options[name])) throw new UsageError(`--${name} is a step number, not ${options[name]}`)
      if (Number(options.from) > Number(options.to)) throw new UsageError('--from is after --to')
    }
  } catch (error) {
    if (error instanceof UsageError) error.message += `\n${usage}`
    throw error
  }
  console.error(await ideVersion(settings.ide))
  const { browser, page, allSteps, position } = await openVisualizer(settings, { downloads: true })
  try {
    if (options.list) {
      for (const { step, text } of await allSteps()) console.log(`${String(step).padStart(3)}  ${text}`)
      return
    }
    await page.locator('.visualizer-options-button').click()
    const item = page.getByRole('menuitem', { name: 'Schritte als Bilder …' })
    if (await item.count() === 0) throw new UsageError(`the ${settings.ide} IDE has no «Schritte als Bilder …» yet${settings.ide === 'live' ? ' (until P68 is promoted to main): use --ide dev' : ''}`)
    await item.click()
    const dialog = page.getByRole('dialog', { name: 'Schritte als Bilder' })
    await dialog.waitFor()
    const last = Number(await dialog.getByLabel('bis Schritt').getAttribute('max'))
    const { of } = await position()
    const count = Number.isFinite(last) && last > 0 ? last : of ?? 0
    for (const name of ['from', 'to']) if (Number(options[name]) > count) throw new UsageError(`--${name} ${options[name]}: the call has steps 0 to ${count}`)
    await dialog.getByLabel('Von Schritt').fill(options.from)
    await dialog.getByLabel('bis Schritt').fill(options.to)
    const downloading = page.waitForEvent('download', { timeout: 600000 })
    await dialog.getByRole('button', { name: 'Herunterladen' }).click()
    const download = await downloading
    const failure = await download.failure()
    if (failure) throw new Error(`the download failed: ${failure}`)
    const out = callerPath(options.out)
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    writeFileSync(out, Buffer.concat(chunks))
    console.error(`${out}: steps ${options.from} to ${options.to} (${download.suggestedFilename()} in the IDE)`)
  } finally {
    await browser.close()
  }
})
