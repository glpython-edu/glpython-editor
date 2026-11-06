// A tree as TreeView draws it: inner nodes with a label (an operator, a
// function's name, a list's first string), leaves with a value's text.
// `key` names a node across trees (else its path is its key, see
// PlacedNode), `className` styles it.
export type TreeNode =
  | { kind: 'node'; label: string; children: TreeNode[]; key?: string; className?: string }
  | { kind: 'leaf'; text: string; key?: string; className?: string }

// A list that reads as a tree, as the runtime sends it (session.py's
// _glpython_tree_of).
export type ValueTree = { label: string; children: ValueTree[] } | { leaf: string }

export function treeFromValue(tree: ValueTree): TreeNode {
  return 'leaf' in tree ? { kind: 'leaf', text: tree.leaf } : { kind: 'node', label: tree.label, children: tree.children.map(treeFromValue) }
}

export type PlacedNode = {
  // The node's own key, else the path of child indices from the root (""
  // for the root, "0.2" for its first child's third child), which stays the
  // same while the tree does.
  key: string
  node: TreeNode
  // The node's centre and width in characters of the code font, its row
  // from 0 at the root.
  x: number
  width: number
  depth: number
  parentKey: string | null
}

export type TreeLayout = { nodes: PlacedNode[]; width: number; depth: number }

// Horizontal room around a node's text, and between two neighbouring
// nodes, in characters.
const NODE_PADDING = 2
const SIBLING_GAP = 2

function textWidth(text: string): number {
  return [...text].length
}

export function nodeWidth(node: TreeNode): number {
  return textWidth(node.kind === 'node' ? node.label : node.text) + NODE_PADDING
}

// A node of the layout while it runs, named as in van der Ploeg's paper:
// `prelim` its preliminary centre relative to its parent's subtree, `mod`
// what it and its subtree move by, `shift`/`change` the moves still to be
// spread over its siblings, `tl`/`tr` the threads that continue a contour
// below a shorter subtree, `el`/`er` the subtree's extreme (lowest leftmost
// and rightmost) nodes with the sums of `mod` down to them (`msel`/`mser`).
type LayoutNode = {
  tree: TreeNode
  // As wide as the node plus SIBLING_GAP (half the gap on each side), so
  // that boxes touching means nodes SIBLING_GAP apart.
  w: number
  y: number
  children: LayoutNode[]
  x: number
  prelim: number
  mod: number
  shift: number
  change: number
  tl: LayoutNode | null
  tr: LayoutNode | null
  el: LayoutNode | null
  er: LayoutNode | null
  msel: number
  mser: number
}

// Every node is one row high.
const bottom = (node: LayoutNode) => node.y + 1

const nextLeftContour = (node: LayoutNode) => (node.children.length === 0 ? node.tl : node.children[0])
const nextRightContour = (node: LayoutNode) => (node.children.length === 0 ? node.tr : node.children[node.children.length - 1])

// The lowest row of the siblings to the left, with the index of the
// rightmost sibling that reaches down to it ("IYL" in the paper).
type LowestSibling = { lowY: number; index: number; next: LowestSibling | null }

function updateLowest(minY: number, index: number, lowest: LowestSibling | null): LowestSibling {
  while (lowest !== null && minY >= lowest.lowY) lowest = lowest.next
  return { lowY: minY, index, next: lowest }
}

function setExtremes(node: LayoutNode) {
  if (node.children.length === 0) {
    node.el = node
    node.er = node
    node.msel = 0
    node.mser = 0
  } else {
    const first = node.children[0]
    const last = node.children[node.children.length - 1]
    node.el = first.el
    node.msel = first.msel
    node.er = last.er
    node.mser = last.mser
  }
}

// The moves of the siblings between `from` and `index`, spread evenly.
function distributeExtra(node: LayoutNode, index: number, from: number, distance: number) {
  if (from === index - 1) return
  const count = index - from
  node.children[from + 1].shift += distance / count
  node.children[index].shift -= distance / count
  node.children[index].change -= distance - distance / count
}

function moveSubtree(node: LayoutNode, index: number, from: number, distance: number) {
  const child = node.children[index]
  child.mod += distance
  child.msel += distance
  child.mser += distance
  distributeExtra(node, index, from, distance)
}

function setLeftThread(node: LayoutNode, index: number, contour: LayoutNode, modSum: number) {
  const first = node.children[0]
  const extreme = first.el as LayoutNode
  extreme.tl = contour
  const difference = modSum - contour.mod - first.msel
  extreme.mod += difference
  extreme.prelim -= difference
  first.el = node.children[index].el
  first.msel = node.children[index].msel
}

function setRightThread(node: LayoutNode, index: number, contour: LayoutNode, modSum: number) {
  const child = node.children[index]
  const extreme = child.er as LayoutNode
  extreme.tr = contour
  const difference = modSum - contour.mod - child.mser
  extreme.mod += difference
  extreme.prelim -= difference
  child.er = node.children[index - 1].er
  child.mser = node.children[index - 1].mser
}

// Moves child `index` right of its left siblings, following the right
// contour of these and its own left contour down, row by row. On the first
// row (the two siblings themselves) it also moves left, so siblings touch
// unless a lower row keeps them apart.
function separate(node: LayoutNode, index: number, lowest: LowestSibling) {
  let right: LayoutNode | null = node.children[index - 1]
  let rightModSum = right.mod
  let left: LayoutNode | null = node.children[index]
  let leftModSum = left.mod
  let current: LowestSibling | null = lowest
  let first = true
  while (right !== null && left !== null) {
    if (current !== null && bottom(right) > current.lowY) current = current.next
    const distance = rightModSum + right.prelim + right.w / 2 - (leftModSum + left.prelim - left.w / 2)
    if (distance > 0 || (first && distance < 0)) {
      leftModSum += distance
      moveSubtree(node, index, current?.index ?? 0, distance)
    }
    first = false
    const rightBottom = bottom(right)
    const leftBottom = bottom(left)
    if (rightBottom <= leftBottom) {
      right = nextRightContour(right)
      if (right !== null) rightModSum += right.mod
    }
    if (rightBottom >= leftBottom) {
      left = nextLeftContour(left)
      if (left !== null) leftModSum += left.mod
    }
  }
  if (right === null && left !== null) setLeftThread(node, index, left, leftModSum)
  else if (right !== null && left === null) setRightThread(node, index, right, rightModSum)
}

// Centred over the span from the first child's left edge to the last
// child's right edge.
function positionRoot(node: LayoutNode) {
  const first = node.children[0]
  const last = node.children[node.children.length - 1]
  node.prelim = (first.prelim + first.mod - first.w / 2 + last.mod + last.prelim + last.w / 2) / 2
}

function firstWalk(node: LayoutNode) {
  if (node.children.length === 0) {
    setExtremes(node)
    return
  }
  firstWalk(node.children[0])
  let lowest = updateLowest(bottom(node.children[0].el as LayoutNode), 0, null)
  for (let index = 1; index < node.children.length; index++) {
    firstWalk(node.children[index])
    const minY = bottom(node.children[index].er as LayoutNode)
    separate(node, index, lowest)
    lowest = updateLowest(minY, index, lowest)
  }
  positionRoot(node)
  setExtremes(node)
}

function addChildSpacing(node: LayoutNode) {
  let shift = 0
  let modSumDelta = 0
  for (const child of node.children) {
    shift += child.shift
    modSumDelta += shift + child.change
    child.mod += modSumDelta
  }
}

function secondWalk(node: LayoutNode, modSum: number) {
  modSum += node.mod
  node.x = node.prelim + modSum
  addChildSpacing(node)
  for (const child of node.children) secondWalk(child, modSum)
}

// A tidy layout, in characters (columns) and rows: children in order below
// their parent, the parent centred over them, and subtrees moved as close
// together as their rows allow, so they never overlap and the same tree
// always lands in the same place. The algorithm is A. van der Ploeg,
// "Drawing non-layered tidy trees in linear time", Software: Practice and
// Experience 44(12), 2014, pp. 1467-1484 - Reingold and Tilford's algorithm
// for nodes of different sizes - following the Java code in its appendix,
// with the changes d3-flextree makes to it: positions are a node's centre,
// not its left edge, and a subtree first moves next to its left sibling
// (see separate), so a narrow node comes as close to a sibling whose
// children are wide as their rows allow. Our nodes are all one row high. scripts/check-tree-layout.mjs compares
// it with d3-flextree, a published implementation of the same paper.
// `room` makes nodes (by key) at least that wide, e.g. for a value that will
// take a node's place later.
export function layoutTree(root: TreeNode, room?: Map<string, number>): TreeLayout {
  let depth = 0
  const build = (tree: TreeNode, row: number, path: string): LayoutNode => {
    depth = Math.max(depth, row + 1)
    const children = tree.kind === 'node' ? tree.children.map((child, index) => build(child, row + 1, path === '' ? String(index) : `${path}.${index}`)) : []
    const width = Math.max(nodeWidth(tree), room?.get(tree.key ?? path) ?? 0)
    return { tree, w: width + SIBLING_GAP, y: row, children, x: 0, prelim: 0, mod: 0, shift: 0, change: 0, tl: null, tr: null, el: null, er: null, msel: 0, mser: 0 }
  }
  const layoutRoot = build(root, 0, '')
  firstWalk(layoutRoot)
  secondWalk(layoutRoot, 0)
  let left = Infinity
  let right = -Infinity
  const visit = (node: LayoutNode, visitor: (node: LayoutNode) => void) => {
    visitor(node)
    for (const child of node.children) visit(child, visitor)
  }
  visit(layoutRoot, (node) => {
    left = Math.min(left, node.x - node.w / 2 + SIBLING_GAP / 2)
    right = Math.max(right, node.x + node.w / 2 - SIBLING_GAP / 2)
  })
  const nodes: PlacedNode[] = []
  const place = (node: LayoutNode, path: string, parentKey: string | null) => {
    const key = node.tree.key ?? path
    nodes.push({ key, node: node.tree, x: node.x - left, width: node.w - SIBLING_GAP, depth: node.y, parentKey })
    node.children.forEach((child, index) => place(child, path === '' ? String(index) : `${path}.${index}`, key))
  }
  place(layoutRoot, '', null)
  return { nodes, width: right - left, depth }
}
