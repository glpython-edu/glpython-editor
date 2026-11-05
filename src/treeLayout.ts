import { flextree, type FlextreeNode } from 'd3-flextree'

// A tree as TreeView draws it: inner nodes with a label (an operator, a
// function's name, a list's first string), leaves with a value's text.
export type TreeNode =
  | { kind: 'node'; label: string; children: TreeNode[] }
  | { kind: 'leaf'; text: string }

// A list that reads as a tree, as the runtime sends it (session.py's
// _glpython_tree_of).
export type ValueTree = { label: string; children: ValueTree[] } | { leaf: string }

export function treeFromValue(tree: ValueTree): TreeNode {
  return 'leaf' in tree ? { kind: 'leaf', text: tree.leaf } : { kind: 'node', label: tree.label, children: tree.children.map(treeFromValue) }
}

export type PlacedNode = {
  // The path of child indices from the root ("" for the root, "0.2" for its
  // first child's third child), which stays the same while the tree does.
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

// A tidy layout, in characters (columns) and rows: children in order below
// their parent, the parent centred over them, and subtrees moved as close
// together as their rows allow, so they never overlap and the same tree
// always lands in the same place. The positions come from d3-flextree: van
// der Ploeg, "Drawing non-layered tidy trees in linear time", Software:
// Practice and Experience 44(12), 2014 - Reingold and Tilford's algorithm
// for nodes of different widths. Every node is one row high, so the rows
// line up.
export function layoutTree(root: TreeNode): TreeLayout {
  const layout = flextree<TreeNode>({
    children: (node) => (node.kind === 'node' && node.children.length > 0 ? node.children : null),
    nodeSize: (node) => [nodeWidth(node.data), 1],
    spacing: SIBLING_GAP,
  })
  const tree = layout.hierarchy(root)
  layout(tree)
  let left = Infinity
  let right = -Infinity
  tree.each((node) => {
    left = Math.min(left, node.x - node.xSize / 2)
    right = Math.max(right, node.x + node.xSize / 2)
  })
  const nodes: PlacedNode[] = []
  const place = (node: FlextreeNode<TreeNode>, key: string, parentKey: string | null) => {
    nodes.push({ key, node: node.data, x: node.x - left, width: node.xSize, depth: node.depth, parentKey })
    node.children?.forEach((child, index) => place(child, key === '' ? String(index) : `${key}.${index}`, key))
  }
  place(tree, '', null)
  return { nodes, width: right - left, depth: tree.height + 1 }
}
