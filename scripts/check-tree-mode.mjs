// Check of the visualizer's tree mode («Baum», P34 A, src/treeMode.ts) on
// traces of the real runtime (CPython runs src/runtime/, as test:runtime
// does):
// - its steps are exactly the substitution mode's (the same objects, in the
//   same order), plus one step that opens each expression's tree and one
//   that closes it - for 2 + 3 * 4, (2 + 3) * 4, quadrat(2 + 1) with a
//   short-form quadrat, and a call with local variables;
// - each tree's labels are Python's (no parentheses: the two first examples
//   differ only in shape), and its text step by step is the evaluation
//   chain's, so tree and chain can't diverge;
// - a reduction moves no node of the tree: only a step that replaces an
//   inline call by its return expression's tree lays it out afresh.
//
//   npm run test:tree
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { buildEvaluationChain, computeOpenFramesUpTo, indexAstNodes, substitutionModeSteps } from '../src/visualizer.ts'
import { buildExpressionTree, episodeTreeLayout, treeModeSteps } from '../src/treeMode.ts'

const programs = {
  precedence: 'x = 2 + 3 * 4\n',
  parentheses: 'x = (2 + 3) * 4\n',
  shortForm: 'def quadrat(x):\n    return x * x\n\ny = quadrat(2 + 1)\n',
  locals: 'def notenschnitt(noten):\n    summe = sum(noten)\n    anzahl = len(noten)\n    return summe / anzahl\n\nnotenschnitt([4, 5, 4.5])\n',
  stepless: 'x = 3\nwerte = [x, -x, 2]\n',
  recursion: 'def fak(n):\n    if n == 0:\n        return 1\n    return n * fak(n - 1)\n\nfak(2)\n',
  labels: 'def summe(x, y):\n    return x + y\n\nsumme(2 + 2, 3 * 4)\n',
  builtins: 'len([1, 2]) + max(2, 5)\n',
  keywords: 'def teile(a, b=2, *rest):\n    return a / b\n\nteile(b=4, a=8)\nteile(6)\nteile(*[9, 3])\n',
  boxInPlace: 'def notenschnitt(noten):\n    summe = sum(noten)\n    anzahl = len(noten)\n    return summe / anzahl\n\nnotenschnitt([4, 5, 4.5]) + 1\n',
}

const python = `
import json, os, sys
runtime_dir = os.path.join(os.getcwd(), "src", "runtime")
sys.path.insert(0, runtime_dir)
runtime = {"__name__": "glpython_runtime"}
for name in ("hints.py", "session.py", "visualizer.py"):
    with open(os.path.join(runtime_dir, name), encoding="utf-8") as handle:
        exec(compile(handle.read(), "<exec>", "exec"), runtime)
programs = json.loads(sys.stdin.read())
print(json.dumps({key: json.loads(runtime["_glpython_trace_program"]("main.py", {"main.py": source}, None)) for key, source in programs.items()}))
`
const run = spawnSync('python3', ['-B', '-c', python], { input: JSON.stringify(programs), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
if (run.status !== 0) throw new Error(run.stderr)
const results = JSON.parse(run.stdout)

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

// A node with its edge label as "label:", a call box as "BOX".
const describeTree = (tree) => `${tree.edgeLabel ? `${tree.edgeLabel}:` : ''}${tree.kind === 'box' ? 'BOX' : tree.kind === 'leaf' ? tree.text : `${tree.label}(${tree.children.map(describeTree).join(', ')})`}`
const describeStep = (step) => step.treePhase ?? (step.kind === 'call-enter' ? `enter ${step.func}` : step.kind)

for (const [name, result] of Object.entries(results)) {
  const source = programs[name]
  const nodeIndexByFile = new Map(Object.entries(result.ast).map(([path, file]) => [path, indexAstNodes(file)]))
  const substitution = substitutionModeSteps(result.trace)
  const { steps, episodes } = treeModeSteps(result.trace, substitution, nodeIndexByFile)
  const context = (step) => ({ trace: result.trace, nodeIndexByFile, sources: { 'main.py': source }, openFrames: computeOpenFramesUpTo(result.trace, step), framesAt: (other) => computeOpenFramesUpTo(result.trace, other), nextKey: null, errorKey: null })
  // Each tree as the visualizer shows it, step by step.
  const shown = episodes.map((episode) => episode.shownSteps.map((step) => buildExpressionTree(context(step), episode, step)))
  result.shown = shown

  check(`${name}: «Baum» is «Ersetzung» plus open and close`, () => {
    assert.deepEqual(steps.filter((step) => !step.treePhase), substitution)
    // Every tree opens right before a step of its own and closes after it.
    for (const episode of episodes) {
      assert.equal(steps[episode.openIndex].treePhase, 'open')
      assert.equal(steps[episode.closeIndex].treePhase, 'close')
      assert.ok(episode.closeIndex > episode.openIndex + 1, 'a tree without a step')
    }
    assert.equal(steps.length, substitution.length + 2 * episodes.length)
  })

  check(`${name}: a reduction moves no node`, () => {
    episodes.forEach((episode, index) => {
      let previous = null
      episode.shownSteps.forEach((step, position) => {
        const built = shown[index][position]
        const layout = episodeTreeLayout(context(step), episode, step, built.tree)
        const places = new Map(layout.nodes.map((placed) => [placed.key, `${placed.x},${placed.depth}`]))
        const isExpansion = episode.expansions.includes(step) && step !== episode.openStep
        if (previous && !isExpansion) {
          assert.ok([...places.keys()].every((key) => previous.has(key)), `a new node at step ${step}`)
          for (const [key, place] of places) assert.equal(place, previous.get(key), `node ${key} moved at step ${step}`)
        }
        previous = places
      })
    })
  })
}

const pattern = (name) => {
  const result = results[name]
  const nodeIndexByFile = new Map(Object.entries(result.ast).map(([path, file]) => [path, indexAstNodes(file)]))
  return treeModeSteps(result.trace, substitutionModeSteps(result.trace), nodeIndexByFile).steps.map(describeStep)
}
const texts = (name, episode = 0) => results[name].shown[episode].map((built) => built.text).filter((text, index, all) => index === 0 || text !== all[index - 1])
const chain = (name) => {
  const result = results[name]
  const nodeIndexByFile = new Map(Object.entries(result.ast).map(([path, file]) => [path, indexAstNodes(file)]))
  const step = result.trace.at(-1)
  return buildEvaluationChain({ trace: result.trace, ast: result.ast, nodeIndexByFile, sources: { 'main.py': programs[name] }, rootPath: 'main.py', step, errorMessage: null, comments: false, strings: { conditionComment: () => '', localsComment: '' } }).split('\n').map((line) => line.replace(/^→ /, ''))
}

check('2 + 3 * 4: the steps', () => assert.deepEqual(pattern('precedence'), ['open', 'eval', 'eval', 'close', 'exec']))
check('2 + 3 * 4: the tree and its text', () => {
  assert.equal(describeTree(results.precedence.shown[0][0].tree), '+(2, *(3, 4))')
  assert.deepEqual(texts('precedence'), ['2 + 3 * 4', '2 + 12', '14'])
  assert.deepEqual(texts('precedence'), chain('precedence'))
})
check('(2 + 3) * 4: only the shape differs, no parentheses', () => {
  assert.deepEqual(pattern('parentheses'), ['open', 'eval', 'eval', 'close', 'exec'])
  assert.equal(describeTree(results.parentheses.shown[0][0].tree), '*(+(2, 3), 4)')
  assert.deepEqual(texts('parentheses'), ['(2 + 3) * 4', '5 * 4', '20'])
  assert.deepEqual(texts('parentheses'), chain('parentheses'))
})
check('quadrat(2 + 1): the call replaced by the tree of its body', () => {
  assert.deepEqual(pattern('shortForm'), ['exec', 'open', 'eval', 'enter quadrat', 'eval', 'close', 'exec'])
  assert.deepEqual(results.shortForm.shown[0].map((built) => describeTree(built.tree)).filter((text, index, all) => index === 0 || text !== all[index - 1]), ['quadrat(x:+(2, 1))', 'quadrat(x:3)', '*(3, 3)', '9'])
  assert.deepEqual(texts('shortForm'), chain('shortForm'))
})
check('notenschnitt([4, 5, 4.5]): a box below the tree, its lines with trees of their own', () => {
  assert.deepEqual(pattern('locals'), ['exec', 'open', 'call-pending', 'enter notenschnitt', 'open', 'eval', 'eval', 'close', 'exec', 'open', 'eval', 'eval', 'close', 'exec', 'open', 'eval', 'eval', 'eval', 'close', 'eval', 'close'])
  const outer = results.locals.shown[0]
  assert.equal(describeTree(outer[0].tree), 'notenschnitt(noten:[4, 5, 4.5])')
  assert.ok(outer.some((built) => built.boxes.some((frame) => frame.funcName === 'notenschnitt')), 'the box of notenschnitt')
  assert.deepEqual(texts('locals', 3), ['summe / anzahl', '13.5 / anzahl', '13.5 / 3', '4.5'])
})
check('[x, -x, 2]: nodes without a step become their value with their last child', () => {
  assert.deepEqual(texts('stepless', 0), ['[x, -x, 2]', '[3, -x, 2]', '[3, -3, 2]'])
  assert.equal(describeTree(results.stepless.shown[0].at(-1).tree), '[3, -3, 2]')
})

const shapes = (name, episode = 0) => results[name].shown[episode].map((built) => describeTree(built.tree)).filter((text, index, all) => index === 0 || text !== all[index - 1])
check('summe(2 + 2, 3 * 4): the parameters on the edges until the call is replaced', () => {
  assert.deepEqual(shapes('labels'), ['summe(x:+(2, 2), y:*(3, 4))', 'summe(x:4, y:*(3, 4))', 'summe(x:4, y:12)', '+(4, 12)', '16'])
  assert.deepEqual(texts('labels'), chain('labels'), 'the text, as the chain')
})
check('len([1, 2]) + max(2, 5): built-in functions get no labels', () => {
  assert.equal(describeTree(results.builtins.shown[0][0].tree), '+(len([1, 2]), max(2, 5))')
})
check('keywords and defaults: the parameter bound; none for *args or a default', () => {
  assert.equal(describeTree(results.keywords.shown[0][0].tree), 'teile(b:4, a:8)', 'by keyword, no "b=" node')
  assert.equal(describeTree(results.keywords.shown[1][0].tree), 'teile(a:6)', 'the default b has no edge')
  assert.equal(describeTree(results.keywords.shown[2][0].tree), 'teile(*([9, 3]))', 'no labels after *')
})
check('notenschnitt([4, 5, 4.5]) + 1: the box in the call node\'s place, 1 beside it', () => {
  const shown = shapes('boxInPlace')
  assert.deepEqual(shown, ['+(notenschnitt(noten:[4, 5, 4.5]), 1)', '+(BOX, 1)', '+(4.5, 1)', '5.5'])
  const episode = treeModeSteps(results.boxInPlace.trace, substitutionModeSteps(results.boxInPlace.trace), new Map(Object.entries(results.boxInPlace.ast).map(([path, file]) => [path, indexAstNodes(file)]))).episodes[0]
  const enter = results.boxInPlace.trace.find((step) => step.kind === 'call-enter')
  const close = results.boxInPlace.trace.find((step) => step.closesFrameId === enter.frameId)
  assert.ok(episode.expansions.includes(enter.step) && episode.expansions.includes(close.step), 'laid out again where the box opens and closes')
})

if (failed > 0) process.exit(1)
console.log('Tree mode checks passed.')
