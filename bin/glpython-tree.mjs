#!/usr/bin/env node
// Draws a list that reads as a tree as an SVG picture (see src/treeSvg.ts):
//
//   glpython-tree "['+', 2, ['*', 3, 4]]" --mark "['*', 3, 4]" -o baum.svg
//
// Without -o, the SVG goes to stdout; without a list, it is read from stdin.
// Options: --mark <subtree> (repeatable), --lang en|de (the picture's
// description), --font-size <px>. Exit code 1 on invalid input or a mark
// that isn't exactly one subtree, 2 on wrong usage.
import { readFileSync, writeFileSync } from 'node:fs'
import { renderTreeSvg, TreeSvgError } from '../dist/tree-svg.js'

const usage = 'Usage: glpython-tree "<list as Python writes it>" [--mark "<subtree>"]... [--lang en|de] [--font-size <px>] [-o <file.svg>]'
const args = process.argv.slice(2)
const marks = []
let text = null
let output = null
let lang = 'en'
let fontSize
for (let index = 0; index < args.length; index++) {
  const arg = args[index]
  const next = () => {
    if (index + 1 >= args.length) {
      console.error(`${arg} needs a value.\n${usage}`)
      process.exit(2)
    }
    return args[++index]
  }
  if (arg === '--mark' || arg === '-m') marks.push(next())
  else if (arg === '-o' || arg === '--output') output = next()
  else if (arg === '--lang') lang = next()
  else if (arg === '--font-size') fontSize = Number(next())
  else if (arg === '-h' || arg === '--help') {
    console.log(usage)
    process.exit(0)
  } else if (text === null) text = arg
  else {
    console.error(`Unexpected argument ${JSON.stringify(arg)}.\n${usage}`)
    process.exit(2)
  }
}
if (lang !== 'en' && lang !== 'de') {
  console.error(`--lang must be en or de.\n${usage}`)
  process.exit(2)
}
if (fontSize !== undefined && !(fontSize > 0)) {
  console.error(`--font-size must be a positive number.\n${usage}`)
  process.exit(2)
}
try {
  const svg = renderTreeSvg(text ?? readFileSync(0, 'utf8').trim(), { mark: marks, lang, fontSize })
  if (output) writeFileSync(output, svg)
  else process.stdout.write(svg)
} catch (error) {
  if (!(error instanceof TreeSvgError)) throw error
  console.error(error.message)
  process.exit(1)
}
