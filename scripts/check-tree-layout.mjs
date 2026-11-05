// Check of the trees' layout (src/treeLayout.ts, P34): our port of van der
// Ploeg's algorithm places every node where d3-flextree, a published
// implementation of the same paper, places it - on the trees of the course's
// parser, two uneven ones and a few hundred random trees (0 to 4 children,
// depth up to 5, labels 1 to 12 characters, a fixed seed). d3-flextree is a
// devDependency for this check only: nothing of it (or of d3-hierarchy) may
// be in the builds, which this checks in the builds' source maps where they
// exist (CI builds first).
//
//   npm run test:layout
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { layoutTree, nodeWidth } from '../src/treeLayout.ts'

const { flextree } = createRequire(import.meta.url)('d3-flextree')
// The same gap between neighbouring nodes as treeLayout.ts.
const SIBLING_GAP = 2
const TOLERANCE = 1e-6

// A list as the runtime sends it (_glpython_tree_of), as a TreeNode.
const treeOf = (value) => Array.isArray(value) && typeof value[0] === 'string'
  ? { kind: 'node', label: value[0], children: value.slice(1).map(treeOf) }
  : { kind: 'leaf', text: typeof value === 'string' ? `'${value}'` : JSON.stringify(value) }

// flextree's positions, moved so that the tree's left edge is at 0, by key.
function oracle(tree) {
  const layout = flextree({ children: (node) => (node.kind === 'node' && node.children.length > 0 ? node.children : null), nodeSize: (node) => [nodeWidth(node.data), 1], spacing: SIBLING_GAP })
  const root = layout.hierarchy(tree)
  layout(root)
  let left = Infinity
  let right = -Infinity
  root.each((node) => {
    left = Math.min(left, node.x - node.xSize / 2)
    right = Math.max(right, node.x + node.xSize / 2)
  })
  const positions = new Map()
  const visit = (node, key) => {
    positions.set(key, { x: node.x - left, depth: node.depth })
    node.children?.forEach((child, index) => visit(child, key === '' ? String(index) : `${key}.${index}`))
  }
  visit(root, '')
  return { positions, width: right - left }
}

function compare(name, tree) {
  const ours = layoutTree(tree)
  const theirs = oracle(tree)
  assert.equal(ours.nodes.length, theirs.positions.size, `${name}: the number of nodes`)
  assert.ok(Math.abs(ours.width - theirs.width) <= TOLERANCE, `${name}: width ${ours.width}, flextree ${theirs.width}`)
  for (const node of ours.nodes) {
    const expected = theirs.positions.get(node.key)
    assert.ok(expected && Math.abs(node.x - expected.x) <= TOLERANCE && node.depth === expected.depth, `${name}: node "${node.key}" at ${node.x}/${node.depth}, flextree ${expected?.x}/${expected?.depth}`)
  }
  return ours.width
}

const courseTrees = [
  ['breit', ['f', ['g', 'erstes', 'zweites'], ['h', 'drittes', 'viertes'], ['k', 'fünftes']], 62],
  ['parse("2 + 3 * 4")', ['+', 2, ['*', 3, 4]], 10.5],
  ['parse("(2 + 3) * 4")', ['*', ['+', 2, 3], 4], 10.5],
  ['parse("-(1 + 2)")', ['-', ['+', 1, 2]], 8],
  ['parse("x + 1")', ['+', ['var', 'x'], 1], 10],
  ['parse("f(1, 2)")', ['f', 1, 2], 8],
  ['uneven, both sides', ['+', ['*', 2, ['-', 7, 3]], ['/', ['+', 1, 2], 3]], 23],
  ['uneven, to the left', ['+', ['+', ['+', 1, 2], 3], ['f', ['var', 'x']]], 17.5],
]
for (const [name, value, width] of courseTrees) assert.equal(compare(name, treeOf(value)), width, `${name}: the width measured for P34`)

// Random trees, the same ones every time (mulberry32).
let seed = 34
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const randomText = () => 'x'.repeat(1 + Math.floor(random() * 12))
const randomTree = (depth) => {
  const arity = depth >= 5 ? 0 : Math.floor(random() * 5)
  return arity === 0 && random() < 0.5
    ? { kind: 'leaf', text: randomText() }
    : { kind: 'node', label: randomText(), children: Array.from({ length: arity }, () => randomTree(depth + 1)) }
}
const RANDOM_TREES = 500
for (let index = 0; index < RANDOM_TREES; index++) compare(`random tree ${index}`, randomTree(0))

// Not in the builds, nor in the notices.
const maps = [
  ...(existsSync('dist/index.js.map') ? ['dist/index.js.map'] : []),
  ...(existsSync('dist-embed/assets') ? readdirSync('dist-embed/assets').filter((name) => name.endsWith('.js.map')).map((name) => `dist-embed/assets/${name}`) : []),
]
for (const map of maps) {
  const bundled = JSON.parse(readFileSync(map, 'utf8')).sources.filter((source) => /node_modules\/(d3-|@types\/d3)/.test(source))
  assert.deepEqual(bundled, [], `${map}: nothing of d3-flextree or d3-hierarchy`)
}
assert.ok(!/flextree|d3-hierarchy|WTFPL/i.test(readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')), 'nothing of it in THIRD_PARTY_NOTICES.md')

console.log(`Tree layout checks passed (${courseTrees.length} trees of the course, ${RANDOM_TREES} random ones; ${maps.length} source maps without d3).`)
