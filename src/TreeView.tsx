import { useMemo } from 'react'
import { layoutTree, type TreeNode } from './treeLayout'

// The height of one row of the tree, in em: a node (1.6em) and the room for
// the edges below it.
const ROW_HEIGHT = 2.8
const NODE_HEIGHT = 1.6

function leafClass(text: string): string {
  if (/^['"]/.test(text)) return 'value-tree-leaf value-tree-leaf--string'
  if (/^-?\d/.test(text)) return 'value-tree-leaf value-tree-leaf--number'
  return 'value-tree-leaf'
}

// A small tree, drawn top-down (see layoutTree): inner nodes with their
// label, leaves with their text. Positions are in characters of the code
// font and in em, so the tree scales with the text around it. For screen
// readers it is an image described by `label` (e.g. the list's own text).
export function TreeView({ tree, label, className }: { tree: TreeNode; label: string; className?: string }) {
  const layout = useMemo(() => layoutTree(tree), [tree])
  const height = layout.depth * ROW_HEIGHT - (ROW_HEIGHT - NODE_HEIGHT)
  const byKey = new Map(layout.nodes.map((placed) => [placed.key, placed]))
  return (
    <span className={`value-tree${className ? ` ${className}` : ''}`} role="img" aria-label={label} style={{ width: `${layout.width}ch`, height: `${height}em` }}>
      <svg className="value-tree-edges" aria-hidden="true" viewBox={`0 0 ${layout.width} ${height}`} preserveAspectRatio="none" style={{ width: `${layout.width}ch`, height: `${height}em` }}>
        {layout.nodes.map((placed) => {
          const parent = placed.parentKey === null ? undefined : byKey.get(placed.parentKey)
          if (!parent) return null
          return <line key={placed.key} x1={parent.x} y1={parent.depth * ROW_HEIGHT + NODE_HEIGHT} x2={placed.x} y2={placed.depth * ROW_HEIGHT} />
        })}
      </svg>
      {layout.nodes.map((placed) => (
        <span key={placed.key} aria-hidden="true" className={placed.node.kind === 'node' ? 'value-tree-node' : leafClass(placed.node.text)} style={{ left: `${placed.x - placed.width / 2}ch`, top: `${placed.depth * ROW_HEIGHT}em`, width: `${placed.width}ch` }}>
          {placed.node.kind === 'node' ? placed.node.label : placed.node.text}
        </span>
      ))}
    </span>
  )
}
