// Check of the static tree pictures (src/treeSvg.ts, P43): renderTreeSvg
// draws the trees of the layout check (the course's parser output and two
// uneven trees), a mark on a subtree, the whole tree marked, a single value,
// and the root node alone marked (also with a subtree, and on a single
// value) exactly as the snapshots in scripts/tree-svg/ - byte for byte, and
// the same twice - with every box where treeLayout.ts places its node (the
// positions TreeView uses). It reads lists as Python writes them, with
// Python's repr for the leaves (compared with CPython's), and reports
// invalid input, a mark that occurs twice and one that doesn't occur. The
// glpython-tree command (bin/) is checked against the build, when there is
// one (CI builds first).
//
//   npm run test:svg            (--update rewrites the snapshots)
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { layoutTree } from '../src/treeLayout.ts'
import { parsePythonValue, pythonRepr, renderTree, renderTreeSvg } from '../src/treeSvg.ts'

const update = process.argv.includes('--update')
const snapshot = (name) => new URL(`tree-svg/${name}.svg`, import.meta.url)

let failed = 0
const check = (label, test) => {
  try {
    test()
    console.log(`${label}: ok`)
  } catch (error) {
    failed += 1
    console.error(`${label}: ${error.message}`)
  }
}

const cases = [
  ['breit', "['f', ['g', 'erstes', 'zweites'], ['h', 'drittes', 'viertes'], ['k', 'fünftes']]"],
  ['2-plus-3-mal-4', "['+', 2, ['*', 3, 4]]"],
  ['2-plus-3-in-klammern-mal-4', "['*', ['+', 2, 3], 4]"],
  ['minus-1-plus-2', "['-', ['+', 1, 2]]"],
  ['x-plus-1', "['+', ['var', 'x'], 1]"],
  ['f-1-2', "['f', 1, 2]"],
  ['uneven-both-sides', "['+', ['*', 2, ['-', 7, 3]], ['/', ['+', 1, 2], 3]]"],
  ['uneven-to-the-left', "['+', ['+', ['+', 1, 2], 3], ['f', ['var', 'x']]]"],
  ['marked-subtree', "['+', 2, ['*', 3, 4]]", { mark: ["['*', 3, 4]"], lang: 'de' }],
  ['marked-root', "['+', 2, ['*', 3, 4]]", { mark: ["['+', 2, ['*', 3, 4]]"] }],
  ['single-value', '42'],
  ['marked-root-node', "['+', 2, ['*', 3, 4]]", { markRoot: true, lang: 'de' }],
  ['marked-root-node-and-subtree', "['+', 2, ['*', 3, 4]]", { markRoot: true, mark: ["['*', 3, 4]"], lang: 'de' }],
  ['marked-single-value', '42', { markRoot: true }],
]
for (const [name, text, options] of cases) {
  check(`${name}: as the snapshot, the same twice`, () => {
    const svg = renderTreeSvg(text, options)
    assert.equal(renderTreeSvg(text, options), svg, 'two runs differ')
    if (update || !existsSync(snapshot(name))) writeFileSync(snapshot(name), svg)
    assert.equal(svg, readFileSync(snapshot(name), 'utf8'), `differs from scripts/tree-svg/${name}.svg (npm run test:svg -- --update after a deliberate change)`)
  })
  check(`${name}: the boxes where treeLayout places them`, () => {
    const { svg, nodes } = renderTree(text, options)
    const expected = layoutTree(nodes[0].node)
    assert.deepEqual(nodes.map(({ key, x, depth, width }) => [key, x, depth, width]), expected.nodes.map(({ key, x, depth, width }) => [key, x, depth, width]))
    // At 16px with characters 0.6em wide, a box starts at 12 + (x - width / 2) * 9.6 (plus half its stroke).
    const boxes = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="[\d.]+" rx="4"[^>]*stroke-width="(\d)"/g)]
    assert.equal(boxes.length, nodes.length, 'one box per node')
    boxes.forEach((box, index) => {
      const node = nodes[index]
      const inset = Number(box[4]) / 2
      assert.ok(Math.abs(Number(box[1]) - (12 + (node.x - node.width / 2) * 9.6 + inset)) < 0.01, `box ${node.key} at x ${box[1]}`)
      assert.ok(Math.abs(Number(box[2]) - (12 + node.depth * 2.8 * 16 + inset)) < 0.01, `box ${node.key} at y ${box[2]}`)
      assert.ok(Math.abs(Number(box[3]) - (node.width * 9.6 - 2 * inset)) < 0.01, `box ${node.key} ${box[3]} wide`)
    })
  })
}

check('the picture is described: role="img", <title> with the list and its marks', () => {
  const svg = renderTreeSvg("['+', 2, ['*', 3, 4]]", { mark: ["['*', 3, 4]"], lang: 'de' })
  assert.match(svg, /^<svg [^>]*role="img"/)
  assert.match(svg, /<title>\['\+', 2, \['\*', 3, 4\]\] – markiert: \['\*', 3, 4\]<\/title>/)
  assert.match(renderTreeSvg("['f', 'a<b&c']"), /<title>\['f', 'a&lt;b&amp;c'\]<\/title>/)
})
check('markRoot: the root box alone, described as the root', () => {
  const svg = renderTreeSvg("['+', 2, ['*', 3, 4]]", { markRoot: true, lang: 'de' })
  assert.equal(svg.match(/fill="#DCE6F2"/g)?.length, 1, 'one marked box')
  assert.doesNotMatch(svg, /<line [^>]*stroke="#1F3A5F"/, 'no marked edge')
  assert.match(svg, /<title>\['\+', 2, \['\*', 3, 4\]\] – markiert: Wurzel<\/title>/)
  const both = renderTreeSvg("['+', 2, ['*', 3, 4]]", { markRoot: true, mark: ["['*', 3, 4]"], lang: 'de' })
  assert.equal(both.match(/fill="#DCE6F2"/g)?.length, 4, 'the root and the subtree')
  assert.equal(both.match(/<line [^>]*stroke="#1F3A5F"/g)?.length, 2, "only the subtree's edges")
  assert.match(both, /– markiert: Wurzel; \['\*', 3, 4\]<\/title>/)
  assert.match(renderTreeSvg('42', { markRoot: true }), /<title>42 – marked: root<\/title>/)
})
check('the tree rule: labels without quotes, strings with, other lists as leaves', () => {
  const { nodes } = renderTree(`["+", "a", [1, 2], ['g'], ["Anna", 'Ben'], True, -2.5, None, (1, 'x')]`)
  assert.deepEqual(nodes.map((placed) => placed.node.kind === 'node' ? `(${placed.node.label})` : placed.node.text), ['(+)', "'a'", '[1, 2]', '(g)', '(Anna)', "'Ben'", 'True', '-2.5', 'None', "(1, 'x')"])
})
check("leaves as Python's repr writes them", () => {
  const values = String.raw`[1, -3, 2.50, 2., -0, 0.1, 1e16, 1.5e-7, 0.0001, 123456789012345678, 1_000, True, False, None, 'a', "it's", 'a"b', "both ' and \"", 'tab\t', 'nl\n', '\\', '\x07', 'é', 'é', (1,), (2), (), [[], [1, [2]]]]`
  const ours = pythonRepr(parsePythonValue(values))
  const python = spawnSync('python3', ['-c', `import sys; print(repr(${values}), end="")`], { encoding: 'utf8' })
  assert.equal(python.status, 0, python.stderr)
  assert.equal(ours, python.stdout)
})
check('errors: invalid input, where it fails', () => {
  for (const [text, message] of [
    ["['+', 2", /Missing "\]" at position 8/],
    ["['+', 2 3]", /Expected "," or "\]" at position 9/],
    ["['+', x]", /Unknown name "x" .* at position 7/],
    ["['a', 'b]", /Unterminated string at position 7/],
    ['', /Expected a value at position 1/],
    ["['+', 1] 2", /Unexpected text after the value at position 10/],
  ]) assert.throws(() => renderTreeSvg(text), message, text)
})
check('errors: a mark that occurs twice, one that is missing, an invalid one', () => {
  assert.throws(() => renderTreeSvg("['+', 3, ['*', 3, 4]]", { mark: ['3'] }), /The mark 3 occurs 2 times/)
  assert.throws(() => renderTreeSvg("['+', 2, ['*', 3, 4]]", { mark: ["['*', 4, 3]"] }), /The mark \['\*', 4, 3\] is not a subtree/)
  assert.throws(() => renderTreeSvg("['+', 2, 3]", { mark: ['[2'] }), /Invalid mark \[2/)
})

// The command, against the build.
if (existsSync(new URL('../dist/tree-svg.js', import.meta.url))) {
  check('glpython-tree: stdout, -o, and exit code 1 on an error', () => {
    const command = (args, input) => spawnSync(process.execPath, ['bin/glpython-tree.mjs', ...args], { encoding: 'utf8', input })
    const plain = command(["['+', 2, ['*', 3, 4]]", '--mark', "['*', 3, 4]", '--lang', 'de'])
    assert.equal(plain.status, 0, plain.stderr)
    assert.equal(plain.stdout, readFileSync(snapshot('marked-subtree'), 'utf8'))
    assert.equal(command([], "['f', 1, 2]\n").stdout, readFileSync(snapshot('f-1-2'), 'utf8'), 'from stdin')
    const wrong = command(["['+', 3, ['*', 3, 4]]", '--mark', '3'])
    assert.equal(wrong.status, 1)
    assert.match(wrong.stderr, /occurs 2 times/)
    assert.equal(command(['--lang', 'fr', '1']).status, 2)
    assert.equal(command(["['+', 2, ['*', 3, 4]]", '--mark-root', '--lang', 'de']).stdout, readFileSync(snapshot('marked-root-node'), 'utf8'), '--mark-root')
  })
} else {
  console.log('glpython-tree: skipped (no build; npm run build first)')
}

if (failed > 0) process.exit(1)
console.log('Tree SVG checks passed.')
