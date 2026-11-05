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
// subtrees, in characters.
const NODE_PADDING = 2
const SIBLING_GAP = 2

function textWidth(text: string): number {
  return [...text].length
}

export function nodeWidth(node: TreeNode): number {
  return textWidth(node.kind === 'node' ? node.label : node.text) + NODE_PADDING
}

// A tidy layout for small trees, in characters (columns) and rows: leaves
// side by side in order, each parent centred over its children, a subtree
// as wide as its widest row needs - so subtrees never overlap and the same
// tree always lands in the same place.
export function layoutTree(root: TreeNode): TreeLayout {
  const spans = new Map<TreeNode, number>()
  const span = (node: TreeNode): number => {
    const own = nodeWidth(node)
    const children = node.kind === 'node' ? node.children : []
    const total = children.length === 0 ? own : Math.max(own, children.reduce((sum, child) => sum + span(child), 0) + SIBLING_GAP * (children.length - 1))
    spans.set(node, total)
    return total
  }
  const width = span(root)
  const nodes: PlacedNode[] = []
  let depth = 0
  const place = (node: TreeNode, left: number, row: number, key: string, parentKey: string | null): number => {
    depth = Math.max(depth, row + 1)
    const total = spans.get(node) ?? 0
    const own = nodeWidth(node)
    const placed: PlacedNode = { key, node, x: left + total / 2, width: own, depth: row, parentKey }
    nodes.push(placed)
    const children = node.kind === 'node' ? node.children : []
    if (children.length > 0) {
      const childrenSpan = children.reduce((sum, child) => sum + (spans.get(child) ?? 0), 0) + SIBLING_GAP * (children.length - 1)
      let start = left + (total - childrenSpan) / 2
      const centres = children.map((child, index) => {
        const centre = place(child, start, row + 1, key === '' ? String(index) : `${key}.${index}`, key)
        start += (spans.get(child) ?? 0) + SIBLING_GAP
        return centre
      })
      const middle = (centres[0] + centres[centres.length - 1]) / 2
      placed.x = Math.min(Math.max(middle, left + own / 2), left + total - own / 2)
    }
    return placed.x
  }
  place(root, 0, 0, '', null)
  return { nodes, width, depth }
}
