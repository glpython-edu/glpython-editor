// The visualizer's tree mode («Baum»): an expression is shown as its syntax
// tree while it is evaluated. Its steps are exactly those of the
// substitution mode, each one reducing a subtree to its value, plus one step
// that opens the tree (the expression replaced by its tree) before the first
// of them and one that closes it (the value in the line again) after the
// last. The tree at a step is built from the AST and the same substitution
// state the substitution mode shows, so tree and chain can't diverge: a call
// shown inline there is replaced by the tree of its return expression here,
// any other call stays a node whose box hangs below the tree.

// With their extensions, so scripts/check-tree-mode.mjs runs it in Node.
import { buildSubstitutionsUpTo, type AstNode, type OpenFrame, type TraceStep } from './visualizer.ts'
import { layoutTree, nodeWidth, type TreeLayout, type TreeNode } from './treeLayout.ts'

// The statements whose expression gets a tree, and which of their fields it
// is. A bare name or literal gets none.
const ROOT_FIELDS: Record<string, string> = { Expr: 'value', Assign: 'value', AugAssign: 'value', AnnAssign: 'value', Return: 'value', If: 'test', While: 'test' }
const NO_TREE_TYPES = new Set(['Name', 'Constant'])
// Nodes that may have no step of their own (P40: a display; #50: "-x" once
// x is a value): without one, they become their value with their last child.
const MAY_BE_STEPLESS = new Set(['List', 'Tuple', 'Set', 'Dict', 'UnaryOp'])
// Steps that reduce something in an expression.
const REDUCING_KINDS = new Set(['eval', 'call-pending', 'call-enter', 'error'])

// One expression's tree, from the step that opens it to the one that closes
// it: steps[openIndex] opens it, steps[closeIndex] closes it (or
// steps.length, when the program fails inside it), and it is shown at every
// index in between. `expansions` are the trace steps (as rendered, i.e.
// `step` numbers) at which the tree's shape grew - its opening, and each
// inline call replaced by its return expression's tree; `stepped` the nodes
// (`frameId:nodeId`) that get a value of their own while it is open,
// `shownSteps` the trace step of each visualizer step that shows it, and
// `calls` the call-enter step of each call in it (by its node's key), which
// names the function and so its parameters. A call that stays a box grows
// the tree too, when its box opens and when it closes.
export type TreeEpisode = {
  id: number
  frameId: number
  path: string
  rootNodeId: number
  openIndex: number
  closeIndex: number
  openStep: number
  closeStep: number
  expansions: number[]
  stepped: Set<string>
  shownSteps: number[]
  calls: Map<string, TraceStep>
}

export type TreeModeSteps = { steps: TraceStep[]; episodes: TreeEpisode[] }

const nodeKey = (frameId: number, nodeId: number) => `${frameId}:${nodeId}`

function childNodes(node: AstNode): AstNode[] {
  const children: AstNode[] = []
  for (const value of Object.values(node.fields)) {
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === 'object') children.push(item as AstNode)
    } else if (value && typeof value === 'object') {
      children.push(value as AstNode)
    }
  }
  return children
}

// Every node inside a tree's expression, mapped to that expression's root.
function treeRootsOf(nodeIndex: Map<number, AstNode>): Map<number, AstNode> {
  const rootOf = new Map<number, AstNode>()
  for (const node of nodeIndex.values()) {
    const field = ROOT_FIELDS[node.type]
    const root = field ? node.fields[field] : null
    if (!root || typeof root !== 'object' || Array.isArray(root) || NO_TREE_TYPES.has(root.type)) continue
    const pending = [root]
    while (pending.length > 0) {
      const current = pending.pop()!
      rootOf.set(current.id, root)
      pending.push(...childNodes(current))
    }
  }
  return rootOf
}

// The substitution mode's steps, with the steps that open and close each
// expression's tree. `substitutionSteps` is substitutionModeSteps(trace).
export function treeModeSteps(trace: TraceStep[], substitutionSteps: TraceStep[], nodeIndexByFile: Map<string, Map<number, AstNode>>): TreeModeSteps {
  const enterByFrame = new Map<number, TraceStep>()
  const traceByStep = new Map<number, TraceStep>()
  for (const step of trace) {
    traceByStep.set(step.step, step)
    if (step.kind === 'call-enter') enterByFrame.set(step.frameId, step)
  }
  const rootsByPath = new Map<string, Map<number, AstNode>>()
  const rootOf = (path: string, nodeId: number) => {
    let roots = rootsByPath.get(path)
    if (!roots) {
      const nodeIndex = nodeIndexByFile.get(path)
      roots = nodeIndex ? treeRootsOf(nodeIndex) : new Map()
      rootsByPath.set(path, roots)
    }
    return roots.get(nodeId) ?? null
  }
  const parentOf = (frameId: number) => enterByFrame.get(frameId)?.parentFrameId ?? 0
  const isWithin = (frameId: number, ancestor: number) => {
    for (let frame = frameId; ; frame = parentOf(frame)) {
      if (frame === ancestor) return true
      if (frame === 0) return false
    }
  }
  // Where a step acts, as the tree sees it: a call-enter at its call site,
  // a step inside an inline call at that call's site (its tree is part of
  // the caller's).
  const hostOf = (step: TraceStep) => {
    let frameId = step.kind === 'call-enter' ? (step.parentFrameId ?? 0) : step.frameId
    let path = step.path
    let nodeId = step.nodeId
    for (let enter = enterByFrame.get(frameId); frameId !== 0 && enter?.shortForm; enter = enterByFrame.get(frameId)) {
      path = enter.path
      nodeId = enter.nodeId
      frameId = enter.parentFrameId ?? 0
    }
    return { frameId, path, nodeId }
  }

  const steps: TraceStep[] = []
  const episodes: TreeEpisode[] = []
  const open = new Map<number, TreeEpisode>()
  const rootNodeOf = (episode: TreeEpisode) => nodeIndexByFile.get(episode.path)?.get(episode.rootNodeId)

  // A step of its own for opening or closing a tree, showing the state after
  // trace step `stateStep` (-1: before the first).
  const phaseStep = (episode: TreeEpisode, stateStep: number, phase: 'open' | 'close', base: TraceStep): TraceStep => {
    const root = rootNodeOf(episode)
    const state = traceByStep.get(stateStep)
    return {
      ...base,
      step: stateStep,
      path: episode.path,
      func: episode.frameId === 0 ? base.func : enterByFrame.get(episode.frameId)?.func ?? base.func,
      line: root?.line ?? base.line,
      endLine: root?.endLine ?? base.endLine,
      col: root?.col ?? base.col,
      endCol: root?.endCol ?? base.endCol,
      kind: 'exec',
      label: '',
      nodeId: episode.rootNodeId,
      valueText: null,
      locals: {},
      fullValues: undefined,
      trees: undefined,
      stdoutLen: state?.stdoutLen ?? 0,
      graphicsLen: state?.graphicsLen ?? 0,
      resetNodeIds: [],
      annotateNodeId: null,
      annotateText: null,
      frameId: episode.frameId,
      parentFrameId: null,
      funcDefNodeId: null,
      funcDefPath: null,
      paramAnnotations: [],
      argSources: [],
      closesFrameId: null,
      lookupName: null,
      lookupFrameId: null,
      shortForm: null,
      boxReason: null,
      returnNodeId: undefined,
      returnNames: undefined,
      conditionText: null,
      treePhase: phase,
    }
  }
  const close = (episode: TreeEpisode, stateStep: number, base: TraceStep) => {
    steps.push(phaseStep(episode, stateStep, 'close', base))
    episode.closeIndex = steps.length - 1
    episode.closeStep = stateStep
    open.delete(episode.frameId)
  }

  for (const step of substitutionSteps) {
    const host = hostOf(step)
    const root = REDUCING_KINDS.has(step.kind) ? rootOf(host.path, host.nodeId) : null
    const current = open.get(host.frameId)
    const belongs = root !== null && current !== undefined && current.path === host.path && current.rootNodeId === root.id
    // Anything else in this frame, or in a call it is waiting for, ends the
    // trees still open there.
    for (const episode of [...open.values()]) {
      if (belongs && episode === current) continue
      if (isWithin(episode.frameId, host.frameId)) close(episode, step.step - 1, step)
    }
    let episode = belongs ? current : undefined
    if (root && !episode && step.kind !== 'error') {
      episode = { id: episodes.length, frameId: host.frameId, path: host.path, rootNodeId: root.id, openIndex: steps.length, closeIndex: -1, openStep: step.step - 1, closeStep: -1, expansions: [step.step - 1], stepped: new Set(), shownSteps: [], calls: new Map() }
      episodes.push(episode)
      open.set(host.frameId, episode)
      steps.push(phaseStep(episode, step.step - 1, 'open', step))
    }
    steps.push(step)
    if (!episode) continue
    if (step.kind === 'call-enter') episode.expansions.push(step.step)
    if (step.closesFrameId !== null && step.closesFrameId !== undefined && !enterByFrame.get(step.closesFrameId)?.shortForm) episode.expansions.push(step.step)
    // Once the expression itself has its value, its tree closes.
    if (step.kind === 'eval' && step.frameId === host.frameId && step.nodeId === root?.id) close(episode, step.step, step)
  }
  const last = steps[steps.length - 1]
  for (const episode of [...open.values()]) {
    if (last?.kind === 'error') {
      episode.closeIndex = steps.length
      episode.closeStep = last.step
      open.delete(episode.frameId)
    } else if (last) {
      close(episode, last.step, last)
    }
  }
  // The nodes that get a value of their own while a tree is open - also in
  // steps the substitution mode doesn't show (a parameter read in an inline
  // call, the step that closes one).
  for (const episode of episodes) {
    episode.shownSteps = steps.slice(episode.openIndex, episode.closeIndex).map((step) => step.step)
    for (const step of trace) {
      if (step.step <= episode.openStep) continue
      if (step.step > episode.closeStep) break
      if (step.kind === 'eval') episode.stepped.add(nodeKey(step.frameId, step.nodeId))
      if (step.kind === 'call-enter' && !episode.calls.has(nodeKey(step.parentFrameId ?? 0, step.nodeId))) episode.calls.set(nodeKey(step.parentFrameId ?? 0, step.nodeId), step)
    }
  }
  return { steps, episodes }
}

// The tree open in each frame at the visualizer's step `index`.
export function activeTreesAt(episodes: TreeEpisode[], index: number): Map<number, TreeEpisode> {
  const active = new Map<number, TreeEpisode>()
  for (const episode of episodes) if (episode.openIndex <= index && index < episode.closeIndex) active.set(episode.frameId, episode)
  return active
}

// Python's precedence, for writing a tree as text with the parentheses it
// needs (the tree's description for screen readers).
const ATOM = 16
const BINARY_PRECEDENCE: Record<string, number> = {
  '|': 7, '^': 8, '&': 9, '<<': 10, '>>': 10, '+': 11, '-': 11, '*': 12, '@': 12, '/': 12, '//': 12, '%': 12, '**': 14,
}
const COMPARE_SYMBOLS: Record<string, string> = {
  Eq: '==', NotEq: '!=', Lt: '<', LtE: '<=', Gt: '>', GtE: '>=', Is: 'is', IsNot: 'is not', In: 'in', NotIn: 'not in',
}

// One node of a built tree, with its text (as the chain writes it) and that
// text's precedence.
type Built = { tree: TreeNode; text: string; precedence: number; isValue: boolean }

export type ExpressionTree = {
  tree: TreeNode
  // The expression as text at this step, e.g. "2 + 12".
  text: string
  // The boxes of calls in the tree that are open (or about to open), in the
  // order of their nodes.
  boxes: OpenFrame[]
}

export type ExpressionTreeContext = {
  trace: TraceStep[]
  nodeIndexByFile: Map<string, Map<number, AstNode>>
  sources: Record<string, string>
  // The frames open at the step (with a box about to open), and at any
  // other step (for laying out the trees shown before).
  openFrames: Map<number, OpenFrame>
  framesAt: (step: number) => Map<number, OpenFrame>
  // The node the next step works on (`frameId:nodeId`), and the failing one.
  nextKey: string | null
  errorKey: string | null
  // A call box's size as drawn (characters, rows), by its key ("box:<frame>").
  boxSize?: (key: string) => { width: number; rows: number } | undefined
}

// A box's size until it has been measured.
const BOX_GUESS = { width: 24, rows: 3 }

// The parameter each argument of a call binds to, for its edge's label:
// positional ones in order (none after a *args), keywords by name (none for
// **kwargs). Null where there is none to name.
function parameterNames(def: AstNode, call: AstNode): { positional: Array<string | null>; keywords: Array<string | null> } {
  const parameters = def.fields.args as AstNode | undefined
  const names = (field: string) => {
    const value = parameters?.fields[field]
    return Array.isArray(value) ? value.filter((item): item is AstNode => item !== null && typeof item === 'object').map((item) => item.summary) : []
  }
  const positional = [...names('posonlyargs'), ...names('args')]
  const byKeyword = new Set([...names('args'), ...names('kwonlyargs')])
  const args = Array.isArray(call.fields.args) ? call.fields.args.filter((item): item is AstNode => item !== null && typeof item === 'object') : []
  const starred = args.some((arg) => arg.type === 'Starred')
  const keywords = Array.isArray(call.fields.keywords) ? call.fields.keywords.filter((item): item is AstNode => item !== null && typeof item === 'object') : []
  return {
    positional: args.map((_, index) => !starred && index < positional.length ? positional[index] : null),
    keywords: keywords.map((keyword) => {
      const name = typeof keyword.fields.arg === 'string' ? keyword.fields.arg.replace(/^'|'$/g, '') : null
      return name !== null && byKeyword.has(name) ? name : null
    }),
  }
}

// The key a step's node has in a tree (see nodeKey): a call-enter's call
// site is in the caller's frame.
export function treeKeyOf(step: TraceStep | null): string | null {
  if (!step || step.treePhase) return null
  return step.kind === 'call-enter' ? nodeKey(step.parentFrameId ?? 0, step.nodeId) : nodeKey(step.frameId, step.nodeId)
}

// The episode's tree after trace step `uptoStep`.
export function buildExpressionTree(context: ExpressionTreeContext, episode: TreeEpisode, uptoStep: number): ExpressionTree | null {
  const { trace, nodeIndexByFile, sources, openFrames, nextKey, errorKey } = context
  // The frames really open (not one about to open): a call is replaced or
  // becomes a box only once its frame is.
  const openNow = context.framesAt(uptoStep)
  const substitutionsByFrame = new Map<string, Map<number, string>>()
  const substitutionsOf = (frameId: number, path: string) => {
    const cacheKey = `${frameId}:${path}`
    let substitutions = substitutionsByFrame.get(cacheKey)
    if (!substitutions) {
      substitutions = new Map(buildSubstitutionsUpTo(trace, uptoStep, frameId).get(path) ?? [])
      const inline = openFrames.get(frameId)
      if (inline?.shortForm) for (const [nodeId, value] of inline.shortForm.paramValues) if (!substitutions.has(nodeId)) substitutions.set(nodeId, value)
      substitutionsByFrame.set(cacheKey, substitutions)
    }
    return substitutions
  }
  const boxes: OpenFrame[] = []
  const sourceText = (path: string, node: AstNode) => {
    const source = sources[path]
    if (source === undefined || node.line === undefined || node.endLine === undefined || node.col === undefined || node.endCol === undefined) return node.summary || node.type
    const lines = source.split('\n')
    if (node.line === node.endLine) return lines[node.line - 1]?.slice(node.col, node.endCol) ?? node.summary
    return [lines[node.line - 1]?.slice(node.col), ...lines.slice(node.line, node.endLine - 1), lines[node.endLine - 1]?.slice(0, node.endCol)].join(' ').replace(/\s+/g, ' ')
  }
  const marked = (key: string) => key === errorKey ? 'visual-error-node' : key === nextKey ? 'visual-next-step' : undefined

  const build = (node: AstNode, frameId: number, path: string): Built => {
    const key = nodeKey(frameId, node.id)
    const className = marked(key)
    const leaf = (text: string, precedence: number, isValue: boolean, kind?: string): Built => ({
      tree: { kind: 'leaf', text, key, className: [kind, className].filter(Boolean).join(' ') || undefined },
      text,
      precedence,
      isValue,
    })
    const value = substitutionsOf(frameId, path).get(node.id)
    if (value !== undefined) return leaf(value, value.startsWith('-') ? 13 : ATOM, true, 'value-tree-leaf--value')
    if (node.type === 'Constant') return leaf(sourceText(path, node), ATOM, true)
    if (node.type === 'Name') return leaf(node.summary, ATOM, false, 'value-tree-leaf--name')

    const child = (field: string) => {
      const value = node.fields[field]
      return value && typeof value === 'object' && !Array.isArray(value) ? build(value, frameId, path) : null
    }
    const list = (field: string) => {
      const value = node.fields[field]
      return Array.isArray(value) ? value.filter((item): item is AstNode => item !== null && typeof item === 'object').map((item) => build(item, frameId, path)) : []
    }
    const inner = (label: string, children: Built[], text: string, precedence: number): Built => {
      // A node without a step of its own becomes its value with its last child.
      if (MAY_BE_STEPLESS.has(node.type) && !episode.stepped.has(key) && children.every((built) => built.isValue)) return leaf(text, precedence, true, 'value-tree-leaf--value')
      return { tree: { kind: 'node', label, children: children.map((built) => built.tree), key, className }, text, precedence, isValue: false }
    }
    const wrap = (built: Built, minimum: number) => built.precedence < minimum ? `(${built.text})` : built.text

    switch (node.type) {
      case 'BinOp': {
        const left = child('left')!
        const right = child('right')!
        const symbol = node.summary
        const precedence = BINARY_PRECEDENCE[symbol] ?? 11
        // "**" binds to the right, the others to the left.
        const text = symbol === '**'
          ? `${wrap(left, precedence + 1)} ** ${wrap(right, precedence)}`
          : `${wrap(left, precedence)} ${symbol} ${wrap(right, precedence + 1)}`
        return inner(symbol, [left, right], text, precedence)
      }
      case 'UnaryOp': {
        const operand = child('operand')!
        const symbol = node.summary
        const precedence = symbol === 'not' ? 5 : 13
        return inner(symbol, [operand], symbol === 'not' ? `not ${wrap(operand, precedence)}` : `${symbol}${wrap(operand, precedence)}`, precedence)
      }
      case 'BoolOp': {
        const values = list('values')
        const precedence = node.summary === 'and' ? 4 : 3
        return inner(node.summary, values, values.map((built) => wrap(built, precedence + 1)).join(` ${node.summary} `), precedence)
      }
      case 'Compare': {
        const left = child('left')!
        const comparators = list('comparators')
        const ops = Array.isArray(node.fields.ops) ? node.fields.ops.map((op) => COMPARE_SYMBOLS[(op as AstNode)?.type] ?? '?') : []
        const text = [wrap(left, 7), ...comparators.flatMap((built, index) => [ops[index], wrap(built, 7)])].join(' ')
        return inner(ops.join(' '), [left, ...comparators], text, 6)
      }
      case 'Call': {
        const func = node.fields.func as AstNode
        // A function of the program's own (it has a call-enter): each
        // argument's edge names its parameter, a keyword argument needs no
        // "name=" node then.
        const enter = episode.calls.get(key)
        const def = enter?.funcDefPath && enter.funcDefNodeId !== null ? nodeIndexByFile.get(enter.funcDefPath)?.get(enter.funcDefNodeId) : undefined
        const names = def ? parameterNames(def, node) : null
        const labelled = (built: Built, name: string | null | undefined): Built => name ? { ...built, tree: { ...built.tree, edgeLabel: name } } : built
        const args = list('args').map((built, index) => labelled(built, names?.positional[index]))
        const keywords = Array.isArray(node.fields.keywords) ? node.fields.keywords.filter((item): item is AstNode => item !== null && typeof item === 'object').map((keyword, index) => {
          const valueNode = keyword.fields.value as AstNode
          const built = build(valueNode, frameId, path)
          const name = typeof keyword.fields.arg === 'string' ? keyword.fields.arg.replace(/^'|'$/g, '') : null
          const parameter = names?.keywords[index]
          if (parameter) return { ...labelled(built, parameter), text: `${name}=${built.text}` }
          const label = name ? `${name}=` : '**'
          return { tree: { kind: 'node' as const, label, children: [built.tree], key: nodeKey(frameId, keyword.id) }, text: `${label}${built.text}`, precedence: ATOM, isValue: false }
        }) : []
        const children = [...args, ...keywords]
        // A call shown inline in the substitution mode: its return
        // expression's tree, with the parameters' values.
        const frame = [...openNow.values()].find((candidate) => candidate.parentFrameId === frameId && candidate.anchorPath === path && candidate.anchorNodeId === node.id)
        if (frame?.shortForm) {
          const returnNode = nodeIndexByFile.get(frame.funcDefPath)?.get(frame.shortForm.returnNodeId)
          if (returnNode) return build(returnNode, frame.frameId, frame.funcDefPath)
        }
        const argsText = children.map((built) => built.text).join(', ')
        // Any other call, once its frame is open: its box, in the call's
        // place (the box's header shows the parameters' values).
        if (frame) {
          boxes.push(frame)
          const boxKey = `box:${frame.frameId}`
          const size = context.boxSize?.(boxKey) ?? BOX_GUESS
          const callText = func?.type === 'Name' ? `${func.summary}(${argsText})` : sourceText(path, node)
          return { tree: { kind: 'box', key: boxKey, width: size.width, rows: size.rows, className }, text: callText, precedence: ATOM, isValue: false }
        }
        if (func?.type === 'Name') return inner(func.summary, children, `${func.summary}(${argsText})`, ATOM)
        if (func?.type === 'Attribute') {
          const object = build(func.fields.value as AstNode, frameId, path)
          return inner(func.summary, [object, ...children], `${wrap(object, ATOM)}${func.summary}(${argsText})`, ATOM)
        }
        const callee = func ? build(func, frameId, path) : null
        return inner('( )', callee ? [callee, ...children] : children, `${callee ? wrap(callee, ATOM) : ''}(${argsText})`, ATOM)
      }
      case 'Attribute': {
        const object = child('value')!
        return inner(node.summary, [object], `${wrap(object, ATOM)}${node.summary}`, ATOM)
      }
      case 'Subscript': {
        const object = child('value')!
        const index = child('slice')!
        return inner('[ ]', [object, index], `${wrap(object, ATOM)}[${index.text}]`, ATOM)
      }
      case 'List':
      case 'Tuple':
      case 'Set': {
        const elements = list('elts')
        const [open, close] = node.type === 'List' ? ['[', ']'] : node.type === 'Set' ? ['{', '}'] : ['(', ')']
        const items = elements.map((built) => built.text).join(', ')
        return inner(`${open} ${close}`, elements, node.type === 'Tuple' && elements.length === 1 ? `(${items},)` : `${open}${items}${close}`, ATOM)
      }
      case 'Dict': {
        const keys = Array.isArray(node.fields.keys) ? node.fields.keys : []
        const values = list('values')
        const pairs = values.map((built, index) => {
          const keyNode = keys[index]
          const keyBuilt = keyNode && typeof keyNode === 'object' ? build(keyNode as AstNode, frameId, path) : null
          return keyBuilt ? { built: { tree: { kind: 'node' as const, label: ':', children: [keyBuilt.tree, built.tree], key: `${key}:${index}` }, text: `${keyBuilt.text}: ${built.text}`, precedence: ATOM, isValue: keyBuilt.isValue && built.isValue } } : { built: { tree: { kind: 'node' as const, label: '**', children: [built.tree], key: `${key}:${index}` }, text: `**${built.text}`, precedence: ATOM, isValue: false } }
        }).map((pair) => pair.built)
        return inner('{ }', pairs, `{${pairs.map((built) => built.text).join(', ')}}`, ATOM)
      }
      case 'IfExp': {
        const body = child('body')!
        const test = child('test')!
        const orelse = child('orelse')!
        return inner('if else', [body, test, orelse], `${wrap(body, 2)} if ${wrap(test, 2)} else ${wrap(orelse, 1)}`, 1)
      }
      case 'Starred': {
        const value = child('value')!
        return inner('*', [value], `*${wrap(value, ATOM)}`, ATOM)
      }
      default:
        // Anything else (an f-string, a comprehension, a lambda, …) is one
        // leaf, written as in the code, until it has its value.
        return leaf(sourceText(path, node), ATOM, false, 'value-tree-leaf--code')
    }
  }

  const root = nodeIndexByFile.get(episode.path)?.get(episode.rootNodeId)
  if (!root) return null
  const built = build(root, episode.frameId, episode.path)
  return { tree: built.tree, text: built.text, boxes }
}

// A layout that keeps every node where it stood: positions come from the
// layout of `shape` (the tree as it last grew) wherever a node is still
// there - a subtree reduced to its value takes its root's place - unless a
// value is too wide for its place; then the tree is laid out afresh.
export function stableTreeLayout(shape: TreeLayout, current: TreeNode): { layout: TreeLayout; fresh: boolean } {
  const now = layoutTree(current)
  const before = new Map(shape.nodes.map((placed) => [placed.key, placed]))
  if (now.nodes.some((placed) => !before.has(placed.key))) return { layout: now, fresh: true }
  // A box that grew (a line of it got longer, a tree opened in it) needs
  // its place made again.
  if (now.nodes.some((placed) => placed.node.kind === 'box' && (placed.rows !== before.get(placed.key)!.rows || placed.width > before.get(placed.key)!.width))) return { layout: now, fresh: true }
  const nodes = now.nodes.map((placed) => {
    const old = before.get(placed.key)!
    return { ...placed, x: old.x, depth: old.depth }
  })
  const rows = new Map<number, typeof nodes>()
  for (const placed of nodes) {
    const row = rows.get(placed.depth)
    if (row) row.push(placed)
    else rows.set(placed.depth, [placed])
  }
  let right = shape.width
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x)
    for (let index = 0; index < row.length; index++) {
      const placed = row[index]
      if (placed.x - placed.width / 2 < 0) return { layout: now, fresh: true }
      right = Math.max(right, placed.x + placed.width / 2)
      const next = row[index + 1]
      if (next && placed.x + placed.width / 2 + 1 > next.x - next.width / 2) return { layout: now, fresh: true }
    }
  }
  return { layout: { nodes, width: right, depth: shape.depth, rows: shape.rows }, fresh: false }
}

// The layout of an episode's tree after trace step `uptoStep`. The tree is
// laid out where it last grew (its opening, an inline call replaced by its
// return expression's tree) with room for the widest text each node shows
// until it grows again - a name's value, a subtree's - so a reduction never
// moves a node.
export function episodeTreeLayout(context: ExpressionTreeContext, episode: TreeEpisode, uptoStep: number, current: TreeNode): TreeLayout {
  const start = Math.max(...episode.expansions.filter((step) => step <= uptoStep), episode.openStep)
  const end = Math.min(...episode.expansions.filter((step) => step > start), Infinity)
  const room = new Map<string, number>()
  let first: TreeNode | null = null
  for (const step of new Set(episode.shownSteps)) {
    if (step < start || step >= end) continue
    const built = step === uptoStep ? { tree: current } : buildExpressionTree({ ...context, openFrames: context.framesAt(step), nextKey: null, errorKey: null }, episode, step)
    if (!built) continue
    first ??= built.tree
    const visit = (node: TreeNode) => {
      if (node.key) room.set(node.key, Math.max(room.get(node.key) ?? 0, nodeWidth(node)))
      if (node.kind === 'node') node.children.forEach(visit)
    }
    visit(built.tree)
  }
  return stableTreeLayout(layoutTree(first ?? current, room), current).layout
}
