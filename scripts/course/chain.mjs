// The → chain of a call as the visualizer gives it (P71), for course
// material: the deployed IDE runs the file, visualizes the call and copies
// the chain with «→ Kette kopieren». With --visible also each step's text as
// the visualizer draws it, checked against the chain (P70 drew
// "9dreifach(3) - 3" where the chain had "9 - 3").
//
//   npm run chain -- --file funktionen.py --call "differenz(2 + 1, dreifach(1))" [--visible]
//     [--mode box|substitution] [--trees] [--lib parser.py …] [--ide live|dev]
//
// stdout: the chain, then (--visible) one line per step. stderr: the IDE's
// version, and what doesn't match. Exit code 1 for a Python error or a step
// that doesn't match, 2 for a wrong option.
import { commonOptions, ideVersion, main, openVisualizer, parseArgs, UsageError } from './ide.mjs'

const usage = `npm run chain -- --file <main.py> --call "<call>" [--visible] [--mode box|substitution] [--trees] [--lib <file.py> …] [--ide live|dev]`

// A chain line without its comment (written after at least four spaces).
const withoutComment = (line) => line.replace(/ {4,}# .*$/, '')
const normal = (text) => text.replace(/\s+/g, ' ').trim()

await main(async () => {
  const argv = process.argv.slice(2)
  if (argv.includes('--help')) { console.log(usage); return }
  const options = parseArgs(argv, { flags: ['visible', 'trees'], values: ['file', 'call', 'mode', 'ide'], repeat: ['lib'] })
  let settings
  try { settings = commonOptions(options) } catch (error) { if (error instanceof UsageError) error.message += `\n${usage}`; throw error }
  console.error(await ideVersion(settings.ide))
  const { browser, allSteps, chain } = await openVisualizer(settings)
  try {
    const steps = options.visible ? await allSteps() : null
    const copied = await chain()
    console.log(copied)
    if (!steps) return
    // Each drawn text that isn't a box or a tree must be a line of the
    // chain, and they come in the chain's order.
    const lines = copied.split('\n').map((line) => normal(withoutComment(line).replace(/^→ /, '')))
    let at = 0
    let mismatches = 0
    console.log('')
    for (const { step, text, boxed } of steps) {
      let note = ''
      if (!boxed) {
        const index = lines.indexOf(normal(text), at)
        if (index === -1) {
          note = lines.includes(normal(text)) ? '   ≠ out of the chain\'s order' : '   ≠ not in the chain'
          mismatches += 1
        } else at = index
      }
      console.log(`${String(step).padStart(3)}  ${text}${note}`)
    }
    if (mismatches > 0) {
      console.error(`${mismatches} step${mismatches === 1 ? '' : 's'} drawn differently from the chain`)
      process.exitCode = 1
    }
  } finally {
    await browser.close()
  }
})
