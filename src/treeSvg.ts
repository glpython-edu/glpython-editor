// A list that reads as a tree, drawn as a static SVG picture - for slides,
// handouts and quiz options made by a compile step, without a browser. The
// tree is the one TreeView draws (the same rule as the runtime's
// _glpython_tree_of, the same layout, see treeLayout.ts) and looks like it:
// solid node boxes, dashed leaf boxes, the light theme's colours, on a light
// card so it reads the same on a light and a dark page. Widths are in
// characters of a monospace font, so no text needs measuring. The same input
// always gives the same bytes.
//
//   renderTreeSvg("['+', 2, ['*', 3, 4]]", { mark: ["['*', 3, 4]"] })
//
// With its extension, so the checks run it in Node.
import { layoutTree, type PlacedNode, type TreeNode } from './treeLayout.ts'

// A value as Python writes it in a list: what the input may contain.
export type PythonValue =
  | { kind: 'list'; items: PythonValue[] }
  | { kind: 'tuple'; items: PythonValue[] }
  | { kind: 'str'; value: string }
  | { kind: 'int'; digits: string }
  | { kind: 'float'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'none' }

export class TreeSvgError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TreeSvgError'
  }
}

// Python's literal syntax for these values, with the place it fails at.
export function parsePythonValue(text: string): PythonValue {
  let position = 0
  const fail = (what: string): never => {
    const shown = text.length > 60 ? `${text.slice(Math.max(0, position - 30), position + 30)}` : text
    const caret = text.length > 60 ? Math.min(30, position) : position
    throw new TreeSvgError(`${what} at position ${position + 1}:\n  ${shown}\n  ${' '.repeat(caret)}^`)
  }
  const skipSpace = () => {
    while (position < text.length && /\s/.test(text[position])) position++
  }
  const value = (): PythonValue => {
    skipSpace()
    const char = text[position]
    if (char === undefined) return fail('Expected a value')
    if (char === '[' || char === '(') return sequence(char === '[' ? ']' : ')')
    if (char === "'" || char === '"') return string()
    if (/[-0-9.]/.test(char)) return number()
    const word = /^[A-Za-z_]\w*/.exec(text.slice(position))?.[0]
    if (word === 'True' || word === 'False') {
      position += word.length
      return { kind: 'bool', value: word === 'True' }
    }
    if (word === 'None') {
      position += word.length
      return { kind: 'none' }
    }
    return fail(word ? `Unknown name "${word}" (only numbers, strings, True, False, None, lists and tuples)` : `Unexpected "${char}"`)
  }
  const sequence = (close: string): PythonValue => {
    position++
    const items: PythonValue[] = []
    let trailingComma = false
    skipSpace()
    while (text[position] !== close) {
      if (position >= text.length) fail(`Missing "${close}"`)
      items.push(value())
      skipSpace()
      trailingComma = false
      if (text[position] === ',') {
        position++
        trailingComma = true
        skipSpace()
      } else if (text[position] !== close) {
        fail(position >= text.length ? `Missing "${close}"` : `Expected "," or "${close}"`)
      }
    }
    position++
    if (close === ']') return { kind: 'list', items }
    // "(1)" is the number 1, "(1,)" a tuple of one.
    return items.length === 1 && !trailingComma ? items[0] : { kind: 'tuple', items }
  }
  const string = (): PythonValue => {
    const quote = text[position]
    const start = position
    position++
    let result = ''
    for (;;) {
      const char = text[position]
      if (char === undefined || char === '\n') {
        position = start
        fail('Unterminated string')
      }
      position++
      if (char === quote) break
      if (char !== '\\') {
        result += char
        continue
      }
      const escape = text[position++]
      const simple: Record<string, string> = { '\\': '\\', "'": "'", '"': '"', n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '0': '\0' }
      if (escape in simple && !(escape === '0' && /[0-7]/.test(text[position] ?? ''))) {
        result += simple[escape]
      } else if (escape === 'x' || escape === 'u' || escape === 'U') {
        const length = { x: 2, u: 4, U: 8 }[escape]
        const hex = text.slice(position, position + length)
        if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) fail(`Invalid \\${escape} escape`)
        const code = parseInt(hex, 16)
        if (code > 0x10ffff) fail(`Invalid \\${escape} escape`)
        result += String.fromCodePoint(code)
        position += length
      } else if (/[0-7]/.test(escape ?? '')) {
        const octal = /^[0-7]{1,3}/.exec(text.slice(position - 1))![0]
        result += String.fromCodePoint(parseInt(octal, 8))
        position += octal.length - 1
      } else {
        // Python keeps an unknown escape as it is.
        result += `\\${escape ?? ''}`
      }
    }
    return { kind: 'str', value: result }
  }
  const number = (): PythonValue => {
    const written = /^-?\s*(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][-+]?\d[\d_]*)?/.exec(text.slice(position))?.[0]
    if (!written) return fail('Expected a number')
    position += written.length
    const negative = written.startsWith('-')
    const body = written.replace(/^-\s*/, '').replace(/_/g, '')
    if (!/[.eE]/.test(body)) {
      if (/^0\d/.test(body) && /[1-9]/.test(body)) {
        position -= written.length
        fail('Leading zeros in a number')
      }
      const digits = body.replace(/^0+(?=\d)/, '')
      return { kind: 'int', digits: negative && digits !== '0' ? `-${digits}` : digits }
    }
    const value = Number(body)
    return { kind: 'float', value: negative ? -value : value }
  }
  const result = value()
  skipSpace()
  if (position < text.length) fail('Unexpected text after the value')
  return result
}

// Python's repr of a float: the shortest text that reads back as the same
// number, with ".0" for a whole number and an exponent from 1e16 or below
// 1e-4.
function floatRepr(value: number): string {
  if (Number.isNaN(value)) return 'nan'
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf'
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0'
  const [mantissa, exponentText] = value.toExponential().split('e')
  const exponent = Number(exponentText)
  const sign = mantissa.startsWith('-') ? '-' : ''
  const digits = mantissa.replace('-', '').replace('.', '')
  if (exponent < -4 || exponent >= 16) {
    const shown = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits
    return `${sign}${shown}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`
  }
  if (exponent < 0) return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`
  const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, '0')
  const fraction = digits.slice(exponent + 1)
  return `${sign}${whole}.${fraction || '0'}`
}

// Python's repr of a string: single quotes unless it has a ' and no ".
function stringRepr(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'"
  let result = quote
  for (const char of value) {
    const code = char.codePointAt(0)!
    if (char === '\\') result += '\\\\'
    else if (char === quote) result += `\\${quote}`
    else if (char === '\n') result += '\\n'
    else if (char === '\r') result += '\\r'
    else if (char === '\t') result += '\\t'
    else if (code < 0x20 || code === 0x7f) result += `\\x${code.toString(16).padStart(2, '0')}`
    else if (code >= 0x80 && code < 0xa0) result += `\\x${code.toString(16)}`
    else result += char
  }
  return result + quote
}

// The value as Python's repr writes it.
export function pythonRepr(value: PythonValue): string {
  switch (value.kind) {
    case 'list': return `[${value.items.map(pythonRepr).join(', ')}]`
    case 'tuple': return value.items.length === 1 ? `(${pythonRepr(value.items[0])},)` : `(${value.items.map(pythonRepr).join(', ')})`
    case 'str': return stringRepr(value.value)
    case 'int': return value.digits
    case 'float': return floatRepr(value.value)
    case 'bool': return value.value ? 'True' : 'False'
    case 'none': return 'None'
  }
}

// The runtime's rule (_glpython_tree_of): a non-empty list whose first
// element is a string is a node with that label; its other elements are
// subtrees where they read as a tree too, else leaves (their repr). Any
// other value is a single leaf. Each node's key is its path ("", "0", "0.2").
function treeOf(value: PythonValue, key: string): TreeNode {
  const readsAsTree = value.kind === 'list' && value.items.length > 0 && value.items[0].kind === 'str'
  if (!readsAsTree) return { kind: 'leaf', text: pythonRepr(value), key }
  const [label, ...children] = value.items
  return { kind: 'node', label: (label as { value: string }).value, key, children: children.map((child, index) => treeOf(child, key === '' ? String(index) : `${key}.${index}`)) }
}

// Where each subtree's value sits, by its repr: to find a marked subtree.
function subtreesOf(value: PythonValue, key: string, found: Array<{ key: string; text: string }>) {
  found.push({ key, text: pythonRepr(value) })
  const readsAsTree = value.kind === 'list' && value.items.length > 0 && value.items[0].kind === 'str'
  if (readsAsTree) value.items.slice(1).forEach((child, index) => subtreesOf(child, key === '' ? String(index) : `${key}.${index}`, found))
}

export type TreeSvgOptions = {
  // Subtrees to highlight, each written as in the input; each must occur
  // exactly once (the whole tree marks the whole tree).
  mark?: string[]
  // Also the root node's box alone (not its edges or children), e.g. for
  // "the operator computed last is at the top"; on a single value, its leaf.
  markRoot?: boolean
  // The code font's size in pixels (default 16).
  fontSize?: number
  // The language of the picture's description: "… – marked: …" (en) or
  // "… – markiert: …" (de).
  lang?: 'en' | 'de'
}

// The look of TreeView in the light theme (src/style.css's tokens), and its
// geometry: rows 2.8em apart, nodes 1.6em high, widths in characters.
const COLOURS = {
  card: '#FFFFFF',
  cardBorder: '#D1D5DB',
  nodeFill: '#F3F4F6',
  nodeStroke: '#6B7280',
  nodeText: '#1F3A5F',
  leafFill: '#FFFFFF',
  leafStroke: '#D1D5DB',
  leafText: '#1A1A1A',
  stringText: '#8A3B12',
  numberText: '#0F5F7A',
  edge: '#6B7280',
  mark: '#1F3A5F',
  markFill: '#DCE6F2',
}
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const ROW_HEIGHT = 2.8
const NODE_HEIGHT = 1.6
// A character of the code font, in em (most monospace fonts: 0.6).
const CHARACTER = 0.6
const RADIUS = 4
const CARD_PADDING = 12

// Fixed precision, no trailing zeros: the same numbers give the same text.
const number = (value: number) => {
  const text = (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, '')
  return text === '-0' ? '0' : text
}
const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export type RenderedTree = {
  svg: string
  // The positions it was drawn with (treeLayout's), for checks.
  nodes: PlacedNode[]
}

export function renderTree(text: string, options: TreeSvgOptions = {}): RenderedTree {
  const value = parsePythonValue(text)
  const tree = treeOf(value, '')
  const subtrees: Array<{ key: string; text: string }> = []
  subtreesOf(value, '', subtrees)
  const marked = new Set<string>()
  const markTexts: string[] = []
  for (const markText of options.mark ?? []) {
    let mark: PythonValue
    try {
      mark = parsePythonValue(markText)
    } catch (error) {
      throw new TreeSvgError(`Invalid mark ${markText}: ${(error as Error).message}`)
    }
    const wanted = pythonRepr(mark)
    const matches = subtrees.filter((subtree) => subtree.text === wanted)
    if (matches.length === 0) throw new TreeSvgError(`The mark ${wanted} is not a subtree of ${pythonRepr(value)}`)
    if (matches.length > 1) throw new TreeSvgError(`The mark ${wanted} occurs ${matches.length} times in ${pythonRepr(value)}; mark a larger subtree that occurs once`)
    marked.add(matches[0].key)
    markTexts.push(wanted)
  }
  const layout = layoutTree(tree)
  const inMarkedSubtree = (key: string) => [...marked].some((root) => root === '' || key === root || key.startsWith(`${root}.`))
  const isMarked = (key: string) => inMarkedSubtree(key) || (options.markRoot === true && key === '')

  const fontSize = options.fontSize ?? 16
  const em = fontSize
  const ch = fontSize * CHARACTER
  const width = layout.width * ch + 2 * CARD_PADDING
  const height = (layout.depth * ROW_HEIGHT - (ROW_HEIGHT - NODE_HEIGHT)) * em + 2 * CARD_PADDING
  const left = (placed: PlacedNode) => CARD_PADDING + (placed.x - placed.width / 2) * ch
  const top = (placed: PlacedNode) => CARD_PADDING + placed.depth * ROW_HEIGHT * em
  const byKey = new Map(layout.nodes.map((placed) => [placed.key, placed]))

  const markNames = [...(options.markRoot ? [options.lang === 'de' ? 'Wurzel' : 'root'] : []), ...markTexts]
  const description = `${pythonRepr(value)}${markNames.length > 0 ? ` – ${options.lang === 'de' ? 'markiert' : 'marked'}: ${markNames.join('; ')}` : ''}`
  const lines: string[] = []
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" role="img" width="${number(width)}" height="${number(height)}" viewBox="0 0 ${number(width)} ${number(height)}" font-family="${FONT}" font-size="${number(fontSize)}">`)
  lines.push(`<title>${escapeXml(description)}</title>`)
  lines.push(`<rect x="0.5" y="0.5" width="${number(width - 1)}" height="${number(height - 1)}" rx="${RADIUS * 2}" fill="${COLOURS.card}" stroke="${COLOURS.cardBorder}"/>`)
  for (const placed of layout.nodes) {
    const parent = placed.parentKey === null ? undefined : byKey.get(placed.parentKey)
    if (!parent) continue
    // An edge inside a marked subtree is marked too.
    const mark = inMarkedSubtree(placed.key) && inMarkedSubtree(parent.key)
    lines.push(`<line x1="${number(CARD_PADDING + parent.x * ch)}" y1="${number(top(parent) + NODE_HEIGHT * em)}" x2="${number(CARD_PADDING + placed.x * ch)}" y2="${number(top(placed))}" stroke="${mark ? COLOURS.mark : COLOURS.edge}" stroke-width="${mark ? 2 : 1}"/>`)
  }
  for (const placed of layout.nodes) {
    const node = placed.node
    const mark = isMarked(placed.key)
    const isNode = node.kind === 'node'
    const label = isNode ? node.label : node.kind === 'leaf' ? node.text : ''
    const textColour = isNode ? COLOURS.nodeText : /^['"]/.test(label) ? COLOURS.stringText : /^-?\d/.test(label) ? COLOURS.numberText : COLOURS.leafText
    const fill = mark ? COLOURS.markFill : isNode ? COLOURS.nodeFill : COLOURS.leafFill
    const stroke = mark ? COLOURS.mark : isNode ? COLOURS.nodeStroke : COLOURS.leafStroke
    const strokeWidth = mark ? 2 : 1
    const inset = strokeWidth / 2
    const boxWidth = placed.width * ch
    lines.push(`<rect x="${number(left(placed) + inset)}" y="${number(top(placed) + inset)}" width="${number(boxWidth - strokeWidth)}" height="${number(NODE_HEIGHT * em - strokeWidth)}" rx="${RADIUS}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${isNode ? '' : ' stroke-dasharray="3 3"'}/>`)
    // The text fills exactly its characters' width, whatever the font's.
    const textWidth = [...label].length * ch
    lines.push(`<text x="${number(left(placed) + boxWidth / 2)}" y="${number(top(placed) + NODE_HEIGHT * em / 2)}" dominant-baseline="central" text-anchor="middle" fill="${textColour}"${isNode ? ' font-weight="600"' : ''}${textWidth > 0 ? ` textLength="${number(textWidth)}" lengthAdjust="spacingAndGlyphs"` : ''} xml:space="preserve">${escapeXml(label)}</text>`)
  }
  lines.push('</svg>')
  return { svg: `${lines.join('\n')}\n`, nodes: layout.nodes }
}

export function renderTreeSvg(text: string, options: TreeSvgOptions = {}): string {
  return renderTree(text, options).svg
}
