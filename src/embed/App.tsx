import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GlPythonWorkspace, type WorkspaceCommand } from '../GlPythonWorkspace'
import {
  isEmbedMode,
  parseParentMessage,
  parseParentOrigin,
  type EmbedMode,
  type GlPythonChildMessage,
  type GlPythonFile,
  type GlPythonProtocolVersion,
} from '../embedProtocol'
import { updateProjectFile, type Project } from '../project'
import type { VisualizerMode } from '../visualizer'
import { coreStrings, resolveUiLocale } from '../i18n'

const defaultSource = 'print("Hello from glpython")'

type ChildMessageWithoutVersion = GlPythonChildMessage extends infer Message ? Message extends unknown ? Omit<Message, 'version'> : never : never

// A single source (protocol version 1) becomes "main.py"; a version 2
// program brings its own files and says which one runs.
function createEmbedProject(source: string, files?: GlPythonFile[], mainFile?: string): Project {
  const programFiles = files && mainFile ? files : [{ path: 'main.py', source }]
  return {
    id: 'liascript-embed',
    name: 'LiaScript',
    mainFile: files && mainFile ? mainFile : 'main.py',
    files: Object.fromEntries(programFiles.map((file) => [file.path, {
      path: file.path,
      label: file.path,
      kind: 'python' as const,
      code: file.source,
    }])),
  }
}

// Optional preset for the visualizer's box/substitution mode, e.g. from a
// LiaScript block's macro option: "?visualizer=box".
// Optional "?features=run,repl,visualize,…" from the macro's features=
// option: which of the embed's own parts to show (here: the REPL, the
// visualizer and the → chain export). Without it, everything shows - except
// "coverage" (after Tests, what no example executed), "listtree" (lists
// that read as a tree drawn as one) and "tree" (the visualizer's mode
// «Baum»), which a course switches on explicitly.
const featureList = (() => {
  const list = new URLSearchParams(window.location.search).get('features')
  return list === null ? null : new Set(list.split(',').map((feature) => feature.trim()))
})()
const features = (feature: string) => featureList === null || featureList.has(feature)

// "?size=large" (the macro's large option): bigger code. The embed's height
// is the parent's to set (the macro: at most 80% of the course's visible
// height, with "large" while visualizing that much); the embed fills its
// iframe and scrolls the visualizer's code inside it (style.css), and
// reports the height its content needs (naturalHeight).
const isLarge = new URLSearchParams(window.location.search).get('size') === 'large'

// The parts that scroll when the iframe is smaller than the content: the
// visualizer's code area and the console.
const SCROLLING_PARTS = '.visualizer-view, .console'

function naturalHeight(root: HTMLElement): number {
  // With its overflow: in a small iframe the parts' minimum heights stick
  // out below the root (measured unrounded, unlike scrollHeight).
  const top = root.getBoundingClientRect().top
  let height = root.getBoundingClientRect().height
  for (const part of root.querySelectorAll('.main-split > *, .editor-column > *, .output-panel > *')) height = Math.max(height, part.getBoundingClientRect().bottom - top)
  for (const element of root.querySelectorAll<HTMLElement>(SCROLLING_PARTS)) {
    const style = getComputedStyle(element)
    // The content's height. The console only ever shrinks, so its
    // scrollHeight is that. The code area also grows to fill the iframe,
    // and scrollHeight is never less than its current height, so there it
    // is the canvas's height plus the padding.
    const canvas = element.classList.contains('visualizer-view') ? element.querySelector<HTMLElement>(':scope > .visualizer-canvas') : null
    const content = canvas ? canvas.getBoundingClientRect().height + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : element.scrollHeight
    const current = element.getBoundingClientRect().height
    // Plus a horizontal scrollbar and borders, within the part's own limits.
    let natural = Math.max(Math.min(content + element.offsetHeight - element.clientHeight, parseFloat(style.maxHeight) || Infinity), parseFloat(style.minHeight) || 0)
    // The code area gets no smaller than its panel's minimum height allows.
    const panel = canvas ? element.closest<HTMLElement>('.editor-panel') : null
    if (panel) natural = Math.max(natural, current - (panel.getBoundingClientRect().height - (parseFloat(getComputedStyle(panel).minHeight) || 0)))
    // Unchanged when it isn't clipped or stretched (no rounding).
    if (Math.abs(natural - current) >= 1) height += natural - current
  }
  return Math.ceil(height)
}

function visualizerModeFromLocation(): VisualizerMode | undefined {
  const mode = new URLSearchParams(window.location.search).get('visualizer')
  return mode === 'box' || mode === 'substitution' || mode === 'tree' ? mode : undefined
}

// The UI language: the host's "?lang=" (e.g. the LiaScript course's), else
// the browser's, else English.
const embedLocale = resolveUiLocale(new URLSearchParams(window.location.search).get('lang'), navigator.language)
document.documentElement.lang = embedLocale

function modeFromLocation(): EmbedMode {
  const mode = new URLSearchParams(window.location.search).get('mode')
  return isEmbedMode(mode) ? mode : 'eval'
}

export function App() {
  const configuredParentOrigin = useMemo(
    () => parseParentOrigin(new URLSearchParams(window.location.search).get('parentOrigin')),
    [],
  )
  const [mode, setMode] = useState<EmbedMode>(modeFromLocation)
  const [project, setProject] = useState(() => createEmbedProject(defaultSource))
  const [isGraphicsOpen, setIsGraphicsOpen] = useState(mode === 'turtle')
  const [command, setCommand] = useState<WorkspaceCommand | null>(null)
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0)
  const commandIdRef = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // The protocol version the parent last spoke (see
  // GLPYTHON_EMBED_PROTOCOL_VERSION): every message to it uses that version,
  // so an older parent never sees one it would reject.
  const parentVersionRef = useRef<GlPythonProtocolVersion>(1)

  const sendToParent = useCallback((message: ChildMessageWithoutVersion) => {
    if (configuredParentOrigin && window.parent !== window) {
      window.parent.postMessage({ ...message, version: parentVersionRef.current }, configuredParentOrigin)
    }
  }, [configuredParentOrigin])

  useEffect(() => {
    if (!configuredParentOrigin || window.parent === window) return

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== configuredParentOrigin) return
      const message = parseParentMessage(event.data)
      if (!message) {
        sendToParent({
          type: 'glpython:error',
          code: 'invalid-message',
          message: 'The parent sent an invalid glpython message.',
        })
        return
      }

      parentVersionRef.current = message.version
      if (message.type === 'glpython:stop') {
        setCommand({ id: ++commandIdRef.current, type: 'stop' })
        return
      }
      if (message.type === 'glpython:reset') {
        // The new workspace starts idle; the parent's stop button must go.
        if (parentVersionRef.current >= 4) sendToParent({ type: 'glpython:busy', busy: false })
        setCommand(null)
        setWorkspaceGeneration((generation) => generation + 1)
        return
      }

      const nextMode = message.mode ?? mode
      setMode(nextMode)
      setIsGraphicsOpen(nextMode === 'turtle')
      setProject(createEmbedProject(message.source, message.files, message.mainFile))
      if (message.type === 'glpython:run' || message.type === 'glpython:visualize' || message.type === 'glpython:test') {
        setCommand({
          id: ++commandIdRef.current,
          type: message.type === 'glpython:run' ? 'run' : message.type === 'glpython:visualize' ? 'visualize' : 'test',
        })
      } else {
        setCommand(null)
      }
    }

    window.addEventListener('message', onMessage)
    sendToParent({
      type: 'glpython:ready',
      capabilities: {
        input: typeof SharedArrayBuffer !== 'undefined',
        files: true,
        tests: true,
        stop: true,
      },
    })
    return () => window.removeEventListener('message', onMessage)
  }, [configuredParentOrigin, mode, sendToParent])

  // The height the embed's content needs, also while its iframe is smaller
  // (then the visualizer's code, or the console, scrolls inside) or taller
  // (then the visualizer fills it): the root's height with each scrolling
  // part at its natural height instead of its current one. Reporting the
  // root's own height instead would keep a small iframe small for good.
  // While visualizing it also says so, so that the parent can give "large"
  // its height.
  useEffect(() => {
    const root = rootRef.current
    if (!root || !configuredParentOrigin) return
    let last = ''
    let frame = 0
    const report = () => {
      frame = 0
      const visualizing = root.querySelector('.glpython-workspace--visualizing') !== null
      const height = naturalHeight(root)
      const key = `${height}:${visualizing}`
      if (key === last) return
      last = key
      sendToParent({ type: 'glpython:resize', height, visualizing })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(report)
    }
    // The root keeps its size while its parts change inside it (it fills
    // the iframe while visualizing), so the scrolling parts and their
    // content are watched too.
    const resizes = new ResizeObserver(schedule)
    const watch = () => {
      resizes.disconnect()
      resizes.observe(root)
      for (const element of root.querySelectorAll(SCROLLING_PARTS)) {
        resizes.observe(element)
        for (const child of element.children) resizes.observe(child)
      }
      schedule()
    }
    const mutations = new MutationObserver(watch)
    mutations.observe(root, { childList: true, subtree: true, characterData: true })
    watch()
    return () => {
      resizes.disconnect()
      mutations.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [configuredParentOrigin, sendToParent])

  // Version 4: the parent's run button becomes a stop button while Python is
  // busy. Older parents don't know the message.
  const reportBusy = useCallback((busy: boolean) => {
    if (parentVersionRef.current >= 4) sendToParent({ type: 'glpython:busy', busy })
  }, [sendToParent])

  if (!configuredParentOrigin && window.parent !== window) {
    return <p className="embed-configuration-error">This embed is missing a valid parentOrigin.</p>
  }

  return (
    <main
      className={`embed-app embed-app--${mode}${isLarge ? ' embed-app--large' : ''}`}
      data-input-available={typeof SharedArrayBuffer !== 'undefined'}
      ref={rootRef}
    >
      <GlPythonWorkspace
        key={`${mode}:${workspaceGeneration}`}
        project={project}
        command={command}
        visualizerMode={visualizerModeFromLocation()}
        onBusyChange={reportBusy}
        activeFile={project.mainFile}
        openFiles={[project.mainFile]}
        onOpenFile={() => undefined}
        onCloseFile={() => undefined}
        onFileCodeChange={(path, code) => setProject((current) => updateProjectFile(current, path, code))}
        isGraphicsOpen={isGraphicsOpen}
        onGraphicsOpenChange={setIsGraphicsOpen}
        t={coreStrings[embedLocale]}
        compact
        capabilities={{
          actions: false,
          editor: false,
          exitVisualizer: mode !== 'visual',
          breadcrumbs: false,
          fileTabs: false,
          resetOutput: false,
          visualization: mode !== 'turtle' && features('visualize'),
          graphics: mode === 'turtle',
          repl: mode === 'eval' && features('repl'),
          export: features('export'),
          coverage: featureList?.has('coverage') ?? false,
          listTree: featureList?.has('listtree') ?? false,
          tree: featureList?.has('tree') ?? false,
          emptyOutput: mode !== 'visual',
        }}
      />
    </main>
  )
}
