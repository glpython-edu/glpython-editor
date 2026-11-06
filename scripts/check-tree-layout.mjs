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
import { edgeLabelPlacement, layoutTree, NODE_HEIGHT, nodeWidth, ROW_HEIGHT } from '../src/treeLayout.ts'

const { flextree } = createRequire(import.meta.url)('d3-flextree')
// The same gap between neighbouring nodes as treeLayout.ts.
const SIBLING_GAP = 2
const TOLERANCE = 1e-6

// A list as the runtime sends it (_glpython_tree_of), as a TreeNode.
const treeOf = (value) => Array.isArray(value) && typeof value[0] === 'string'
  ? { kind: 'node', label: value[0], children: value.slice(1).map(treeOf) }
  : { kind: 'leaf', text: typeof value === 'string' ? `'${value}'` : JSON.stringify(value) }

// The room an edge label takes (as treeLayout's edgeLabelRoom).
const labelRoom = (node) => node.edgeLabel ? 2 * (0.4 + [...node.edgeLabel].length * 0.75) : 0
// flextree's positions, moved so that the tree's left edge is at 0, by key.
// A box is as many rows high as it says (only leaves are boxes, so every
// row starts where flextree starts it: below a parent one row high).
function oracle(tree) {
  const layout = flextree({ children: (node) => (node.kind === 'node' && node.children.length > 0 ? node.children : null), nodeSize: (node) => [Math.max(nodeWidth(node.data), labelRoom(node.data)), node.data.kind === 'box' ? node.data.rows : 1], spacing: SIBLING_GAP })
  const root = layout.hierarchy(tree)
  layout(root)
  let left = Infinity
  let right = -Infinity
  root.each((node) => {
    left = Math.min(left, node.x - node.xSize / 2)
    right = Math.max(right, node.x + node.xSize / 2)
  })
  const positions = new Map()
  const visit = (node, path) => {
    positions.set(node.data.key ?? path, { x: node.x - left, depth: node.depth })
    node.children?.forEach((child, index) => visit(child, path === '' ? String(index) : `${path}.${index}`))
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

// The tree mode's trees: some leaves are call boxes several rows high, some
// edges have labels (a parameter's name). Still flextree's positions, and
// no label touches a node or another label.
const randomCallTree = (depth) => {
  const arity = depth >= 4 ? 0 : Math.floor(random() * 4)
  const edgeLabel = random() < 0.5 ? 'x'.repeat(1 + Math.floor(random() * 6)) : undefined
  if (arity === 0) return random() < 0.3
    ? { kind: 'box', key: `box${Math.floor(random() * 1e9)}`, width: 10 + Math.floor(random() * 40), rows: 1 + Math.floor(random() * 50) / 10, edgeLabel }
    : { kind: 'leaf', text: randomText(), edgeLabel }
  return { kind: 'node', label: randomText(), children: Array.from({ length: arity }, () => randomCallTree(depth + 1)), edgeLabel }
}
const rectsOf = (layout) => {
  const byKey = new Map(layout.nodes.map((placed) => [placed.key, placed]))
  const nodes = layout.nodes.map((placed) => ({ key: placed.key, left: placed.x - nodeWidth(placed.node) / 2, right: placed.x + nodeWidth(placed.node) / 2, top: placed.depth * ROW_HEIGHT, bottom: placed.depth * ROW_HEIGHT + (placed.node.kind === 'box' ? placed.rows * ROW_HEIGHT - (ROW_HEIGHT - NODE_HEIGHT) : NODE_HEIGHT) }))
  const labels = layout.nodes.flatMap((placed) => {
    const parent = byKey.get(placed.parentKey)
    const place = parent ? edgeLabelPlacement(placed, parent) : null
    return place ? [{ key: `label:${placed.key}`, ...place }] : []
  })
  return { nodes, labels }
}
const overlaps = (a, b) => a.left < b.right - 1e-9 && b.left < a.right - 1e-9 && a.top < b.bottom - 1e-9 && b.top < a.bottom - 1e-9
let labelled = 0
for (let index = 0; index < RANDOM_TREES; index++) {
  const tree = randomCallTree(0)
  compare(`random call tree ${index}`, tree)
  const { nodes, labels } = rectsOf(layoutTree(tree))
  labelled += labels.length
  for (const label of labels) {
    for (const other of [...nodes, ...labels]) if (other !== label) assert.ok(!overlaps(label, other), `random call tree ${index}: ${label.key} overlaps ${other.key}`)
  }
}
assert.ok(labelled > RANDOM_TREES, 'labels were checked')

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

console.log(`Tree layout checks passed (boxes and edge labels in ${RANDOM_TREES} call trees too)`)
console.log(`Tree layout checks passed (${courseTrees.length} trees of the course, ${RANDOM_TREES} random ones; ${maps.length} source maps without d3).`)
