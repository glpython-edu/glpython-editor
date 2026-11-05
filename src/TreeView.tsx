import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { layoutTree, type TreeNode } from './treeLayout'

// The height of one row of the tree, in em: a node (1.6em) and the room for
// the edges below it.
const ROW_HEIGHT = 2.8
const NODE_HEIGHT = 1.6
// How far an arrow key scrolls a tree wider than its place, in pixels.
const KEY_SCROLL_STEP = 40

// The colour behind the tree, for the hints' fade: the first ancestor's
// background that isn't transparent.
function backgroundBehind(element: HTMLElement): string | null {
  for (let current = element.parentElement; current; current = current.parentElement) {
    const colour = getComputedStyle(current).backgroundColor
    if (colour && colour !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(colour)) return colour
  }
  return null
}

function leafClass(text: string): string {
  if (/^['"]/.test(text)) return 'value-tree-leaf value-tree-leaf--string'
  if (/^-?\d/.test(text)) return 'value-tree-leaf value-tree-leaf--number'
  return 'value-tree-leaf'
}

// A small tree, drawn top-down (see layoutTree): inner nodes with their
// label, leaves with their text. Positions are in characters of the code
// font and in em, so the tree scales with the text around it. For screen
// readers it is an image described by `label` (e.g. the list's own text).
// A tree wider than its place scrolls sideways: it starts with its root in
// the middle (in an expression tree, the operation applied last), a hint at
// each edge shows that more is hidden there (a fade into the background
// with an arrow, over the tree's whole height, so it doesn't read as a
// node), and it takes the focus, so the arrow keys scroll it.
export function TreeView({ tree, label, className }: { tree: TreeNode; label: string; className?: string }) {
  const layout = useMemo(() => layoutTree(tree), [tree])
  const height = layout.depth * ROW_HEIGHT - (ROW_HEIGHT - NODE_HEIGHT)
  const byKey = new Map(layout.nodes.map((placed) => [placed.key, placed]))
  const frameRef = useRef<HTMLSpanElement>(null)
  const scrollRef = useRef<HTMLSpanElement>(null)
  const [fade, setFade] = useState<string | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const scrolledRef = useRef(false)
  const [hidden, setHidden] = useState({ left: false, right: false })
  const updateHidden = useCallback(() => {
    const view = scrollRef.current
    if (!view) return
    const left = view.scrollLeft > 1
    const right = view.scrollLeft + view.clientWidth < view.scrollWidth - 1
    setHidden((previous) => (previous.left === left && previous.right === right ? previous : { left, right }))
  }, [])
  // The root in the middle - again when the place changes size, until the
  // tree has been scrolled.
  useLayoutEffect(() => {
    const view = scrollRef.current
    const root = rootRef.current
    if (!view || !root) return
    scrolledRef.current = false
    const centre = () => {
      if (!scrolledRef.current) view.scrollLeft = root.offsetLeft + root.offsetWidth / 2 - view.clientWidth / 2
      updateHidden()
    }
    centre()
    if (frameRef.current) setFade(backgroundBehind(frameRef.current))
    const observer = new ResizeObserver(centre)
    observer.observe(view)
    return () => observer.disconnect()
  }, [layout, updateHidden])
  const onScroll = () => {
    updateHidden()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    const view = event.currentTarget
    const target = { ArrowLeft: view.scrollLeft - KEY_SCROLL_STEP, ArrowRight: view.scrollLeft + KEY_SCROLL_STEP, Home: 0, End: view.scrollWidth }[event.key]
    if (target === undefined) return
    event.preventDefault()
    scrolledRef.current = true
    view.scrollLeft = target
  }
  const overflows = hidden.left || hidden.right
  return (
    <span ref={frameRef} className={`value-tree-frame${className ? ` ${className}` : ''}`} style={fade ? ({ '--value-tree-fade': fade } as CSSProperties) : undefined}>
      <span ref={scrollRef} className="value-tree-scroll" role="img" aria-label={label} tabIndex={overflows ? 0 : undefined} onScroll={onScroll} onKeyDown={onKeyDown} onPointerDown={() => { scrolledRef.current = true }} onWheel={() => { scrolledRef.current = true }} onTouchStart={() => { scrolledRef.current = true }}>
        <span className="value-tree" style={{ width: `${layout.width}ch`, height: `${height}em` }}>
          <svg className="value-tree-edges" aria-hidden="true" viewBox={`0 0 ${layout.width} ${height}`} preserveAspectRatio="none" style={{ width: `${layout.width}ch`, height: `${height}em` }}>
            {layout.nodes.map((placed) => {
              const parent = placed.parentKey === null ? undefined : byKey.get(placed.parentKey)
              if (!parent) return null
              return <line key={placed.key} x1={parent.x} y1={parent.depth * ROW_HEIGHT + NODE_HEIGHT} x2={placed.x} y2={placed.depth * ROW_HEIGHT} />
            })}
          </svg>
          {layout.nodes.map((placed) => (
            <span key={placed.key} ref={placed.parentKey === null ? rootRef : undefined} aria-hidden="true" data-tree-key={placed.key} className={placed.node.kind === 'node' ? 'value-tree-node' : leafClass(placed.node.text)} style={{ left: `${placed.x - placed.width / 2}ch`, top: `${placed.depth * ROW_HEIGHT}em`, width: `${placed.width}ch` }}>
              {placed.node.kind === 'node' ? placed.node.label : placed.node.text}
            </span>
          ))}
        </span>
      </span>
      {hidden.left && <span className="value-tree-hint value-tree-hint--left" aria-hidden="true">‹</span>}
      {hidden.right && <span className="value-tree-hint value-tree-hint--right" aria-hidden="true">›</span>}
    </span>
  )
}
