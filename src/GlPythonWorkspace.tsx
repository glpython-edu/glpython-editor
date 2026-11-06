import { createPortal } from 'react-dom'
import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type { Monaco, OnMount } from '@monaco-editor/react'
import { AlertTriangle, BookOpen, Copy, Square, FileCode2, FlaskConical, Lock, PanelRightClose, PanelRightOpen, ChevronLeft, ChevronRight, Ellipsis, Play, RotateCcw, SkipBack, SkipForward, Sparkles, SquareTerminal, Terminal, Workflow, X } from 'lucide-react'
import { projectImportsGturtle, type Project } from './project'
import { GraphicsWindow, type TurtleCommand } from './GraphicsWindow'
import { buildAnnotationsUpTo, buildEvaluationChain, buildExecutedLinesUpTo, buildLocalsUpTo, buildSubstitutionsUpTo, collapseDeepCallChain, hasEvaluationChain, fullValuesUpTo, valueTreesUpTo, hiddenRangesWithin, removedLines, computeLineOffsets, computeOpenFramesUpTo, indexAstNodes, lineNumberAtOffset, locateNodeRenderedRange, nodeRange, renderFrameSource, substitutionModeSteps, type AstNode, type CollapsedCalls, type FullValue, type OpenFrame, type BoxReason, type TraceResult, type TraceStep, type VisualizerMode } from './visualizer'
import { tokenizePythonFragment } from './pyHighlight'
import { GLPYTHON_PYTHON, registerGlpythonPython } from './pythonLanguage'
import { defineGlpythonTheme, GLPYTHON_THEME } from './monacoTheme'
import type { ErrorHint, ErrorHintContext } from './errorHints'
import { TreeView } from './TreeView'
import { layoutTree, treeFromValue, type TreeLayout, type TreeNode, type ValueTree } from './treeLayout'
import { activeTreesAt, buildExpressionTree, episodeTreeLayout, treeKeyOf, treeModeSteps, type TreeEpisode } from './treeMode'

type CoreStrings = {
  exitVisualizer: string
  readyOutput: string
  resetOutput: string
  visualize: string
  visualizing: string
  runProject: string
  running: string
  runningOutput: (mainFile: string) => string
  visualizerBeforeStart: string
  visualizerStepOf: (current: number, total: number) => string
  visualizerNoSteps: string
  visualizerRestart: string
  visualizerPrevStep: string
  visualizerNextStep: string
  visualizerAnimate: string
  visualizerError: (message: string) => string
  visualizerTruncated: string
  // Marker replacing the middle of a deep chain of call boxes, e.g.
  // "… 158 more calls of loop(3) …"; `call` is null when the hidden calls
  // are to different functions. Optional so existing hosts keep compiling -
  // an English fallback is used when it's missing.
  visualizerCollapsedCalls?: (count: number, call: string | null) => string
  // The visualizer bar's jump to the first and the last step and its «⋯
  // Options» menu. Optional, like visualizerCollapsedCalls.
  visualizerFirstStep?: string
  visualizerLastStep?: string
  visualizerOptions?: string
  // No longer shown: the REPL's button that visualized the typed input,
  // replaced by replVisualizeEntry. Kept so hosts that set it compile.
  replVisualize?: string
  // The button on each REPL history entry that visualizes it, and the note
  // shown instead when its replay (see _glpython_replay_begin) needs input()
  // or doesn't reproduce the history. Optional, like
  // visualizerCollapsedCalls.
  replVisualizeEntry?: string
  replReplayNote?: (reason: ReplReplayNote) => string
  // The button that replaces the run button while Python is busy, and the
  // note it leaves in the console (one button that is never disabled, so
  // keyboard focus stays on it).
  // Optional, like visualizerCollapsedCalls.
  stop?: string
  stoppedNote?: string
  // The stacked layout's divider between editor and console (its accessible
  // name), and the empty editor's placeholder. Optional, like
  // visualizerCollapsedCalls.
  consoleSize?: string
  editorPlaceholder?: string
  // A read-only file (ProjectFile.readOnly): the lock's label on its tab, and
  // the message when typing into it. Optional, like editorPlaceholder.
  readOnlyFile?: string
  // Accessible name of the REPL's input line, and the note shown after a
  // "def"/"class" typed into the REPL. Optional like visualizerCollapsedCalls.
  replInputLabel?: string
  replDefinitionHint?: string
  // The visualizer's mode toggle (its group label and the two modes), and
  // the note in a box shown in the substitution mode. Optional, like
  // visualizerCollapsedCalls.
  visualizerModeLabel?: string
  visualizerModeBox?: string
  visualizerModeSubstitution?: string
  visualizerBoxHint?: string
  // The third mode («Baum», with the `tree` capability), and why a call stays
  // a box in the substitution and tree modes: the text after the function's
  // name, e.g. "has local variables – the call is shown as a box."
  visualizerModeTree?: string
  // A Markdown tab's switch (with the host's renderMarkdown): its label, and
  // the file as a page or as its text.
  markdownViewLabel?: string
  markdownPage?: string
  markdownText?: string
  visualizerBoxReason?: (reason: BoxReason) => string
  // The visualizer's "copy the evaluation as a → chain" button, its
  // confirmation, its failure message, the switch for the chain's reason
  // comments, and those comments ("2 == 0 is False", "body with local
  // variables"). Optional, like visualizerCollapsedCalls.
  copyChain?: string
  copyChainDone?: string
  copyChainFailed?: string
  copyChainComments?: string
  chainConditionComment?: (condition: string, value: string) => string
  chainLocalsComment?: string
  // What the variables panel shows for a function, class or module instead
  // of its value (the runtime describes them as "function", "class" and
  // "module"). Real Python values and reprs are never translated.
  valueKindFunction?: string
  // The Tests button, the doctest summary ("3 of 4 examples passed"), what
  // shows when there are no examples or the file doesn't load, the button
  // that visualizes a failing example, and the hint for an example that
  // printed what was expected but returned None. doctest's own report text
  // ("Expected:", "Got:") is never translated.
  runTests?: string
  testsRunning?: string
  testsSummary?: (passed: number, total: number) => string
  testsNone?: string
  testsLoadError?: (message: string) => string
  visualizeExample?: string
  testsPrintHint?: (source: string, output: string) => string
  // Coverage after Tests (capability `coverage`), when all examples passed:
  // the heading above the lines no example executed, each entry's label
  // ("Zeile 11:", "Zeilen 8–12:"), and the note when every line ran - which
  // must not read as "done": covered code can still be wrong.
  testsUncoveredHeading?: string
  testsUncoveredLines?: (start: number, end: number) => string
  testsAllCovered?: string
  // Shown under the final value when a failing doctest example is
  // visualized: the output doctest got and the one the example expected,
  // e.g. "Got: 4.0 · Expected: 4".
  exampleGotExpected?: (got: string, want: string) => string
  // A short hint below an error for one of the unit's common mistakes (see
  // hints.py), its label («Hinweis:»), and the Tests report's message when
  // doctest can't read the examples (e.g. no blank after ">>>"). Names in
  // `backticks` are shown as code. Optional, like visualizerCollapsedCalls;
  // without errorHint no hints show.
  errorHint?: (hint: ErrorHint, context: ErrorHintContext) => string | null
  hintLabel?: string
  testsExamplesError?: (message: string) => string
  valueKindClass?: string
  valueKindModule?: string
  closeFile: (path: string) => string
  output: string
  pyodideRuntime: string
  runsFile: (mainFile: string) => string
  noOutput: string
  turtleGraphics: string
  gturtleWindow: string
  collapseGraphics: string
  expandGraphics: string
  graphicsEmptyBefore: string
  graphicsEmptyAfter: string
  graphicsCollapsedLabel: string
  inputDialogTitle: string
  // The console's input line while the program waits in input() (its label for screen readers).
  programInputLabel?: string
  // An abbreviated value in the visualizer ("[1, 2, 3, 4, 5, …, 100]"): the
  // title of the button showing it in full, how many elements or characters
  // it has (`kind` is Python's type name), and its dialog.
  visualizerShowFullValue?: string
  visualizerValueLength?: (length: number, kind: string | null) => string
  visualizerFullValueTitle?: (name: string | null) => string
  visualizerFullValueCut?: string
  visualizerCloseFullValue?: string
  // listtree: the options menu's switch, the panel's link for a tree too
  // wide for it, and a REPL value's button.
  visualizerListTrees?: string
  showTree?: string
  replShowTree?: string
  inputDialogFallbackPrompt: string
  inputPlaceholder: string
  inputCancel: string
  inputSubmit: string
}

type WorkspaceCapabilities = {
  actions: boolean
  editor: boolean
  exitVisualizer: boolean
  breadcrumbs: boolean
  fileTabs: boolean
  resetOutput: boolean
  visualization: boolean
  graphics: boolean
  // An input line below the output that runs Python in the namespace of the
  // last Run, e.g. to call the file's functions.
  repl: boolean
  // A Tests button that runs the doctests in the file's docstrings.
  tests: boolean
  // The visualizer's "copy → chain" button and its comments switch.
  export: boolean
  // After Tests, when all examples pass: which lines of the file's functions
  // no example executed, in the report and (with the editor) marked in it.
  coverage: boolean
  // The output panel of a visualization whose program prints nothing and
  // raises no error, showing «(Keine Ausgabe)». Off for visualization-only
  // embeds, so a short visualization takes less space.
  emptyOutput: boolean
  // A ✕ on each file tab (closing it). Off when the host shows every file of
  // the project as a tab, as the IDE does.
  closeFileTabs: boolean
  // Lists that read as a tree (["+", 2, ["*", 3, 4]]: a first element that is
  // a string) drawn as one too, below their text: in the visualizer's
  // variables and full-value dialog (with a switch in its options menu), and
  // on request («Baum») for a REPL input's value.
  listTree: boolean
  // The visualizer's third mode, «Baum»: an expression as its tree while it
  // is evaluated (see treeMode.ts).
  tree: boolean
}

const defaultWorkspaceCapabilities: WorkspaceCapabilities = {
  actions: true,
  editor: true,
  exitVisualizer: true,
  breadcrumbs: true,
  fileTabs: true,
  resetOutput: true,
  visualization: true,
  graphics: true,
  repl: true,
  tests: true,
  export: true,
  coverage: false,
  emptyOutput: true,
  closeFileTabs: true,
  listTree: false,
  tree: false,
}

type WorkspaceCommand = {
  id: number
  type: 'run' | 'visualize' | 'reset' | 'test' | 'stop'
}

type CoverageGap = { start: number; end: number; code: string }

// What the worker reports for a Tests run (see doctests.py).
type TestReport = {
  // The file failed while running (its traceback is the program's output),
  // so there is no report.
  skipped?: boolean
  attempted?: number
  failed?: number
  // `want`/`got` only for an example whose output didn't match (not one that raised).
  failures?: Array<{ name: string; line: number; source: string; text: string; want?: string; got?: string; errorHint?: ErrorHint | null }>
  printHints?: Array<{ source: string; output: string }>
  // With the coverage capability: what no example executed, as groups of
  // consecutive statements of one function (lines `start`-`end`, their code).
  uncovered?: CoverageGap[]
  // The file didn't load, or doctest couldn't read its examples; with the
  // hint for that error, if any.
  error?: string
  examplesError?: string
  errorHint?: ErrorHint | null
  output?: string
}

type GlPythonWorkspaceProps = {
  project: Project
  activeFile: string
  openFiles: string[]
  onOpenFile: (path: string) => void
  onCloseFile: (path: string) => void
  onFileCodeChange: (path: string, code: string) => void
  isGraphicsOpen: boolean
  onGraphicsOpenChange: (open: boolean) => void
  t: CoreStrings
  capabilities?: Partial<WorkspaceCapabilities>
  compact?: boolean
  command?: WorkspaceCommand | null
  // Presets the visualizer's mode (e.g. from a LiaScript block). Without it
  // the mode last chosen in this browser is used, and «substitution» at first.
  visualizerMode?: VisualizerMode
  // Called when Python starts or stops being busy for more than a moment
  // (a program, a REPL input, Tests, a visualization) - while it is, the run
  // button is a stop button. The embed passes it on to its parent.
  onBusyChange?: (busy: boolean) => void
  // Where the buttons (▶ Run · Tests · Visualize · Reset) go, e.g. the
  // host's top bar; without it they sit above the editor. Only in the
  // stacked (not compact) layout.
  actionsContainer?: HTMLElement | null
  // Draws a Markdown file (".md") as a page: the host's renderer, which must
  // return sanitized HTML (the IDE: marked + DOMPurify). With it, a
  // Markdown tab has a «View / Text» switch; a read-only file opens as
  // the page, an editable one as its text. Without it, Markdown is text.
  renderMarkdown?: (source: string) => string
}

// Busy for less than this, the run button stays as it is, so a quick REPL
// input doesn't make it flicker into a stop button and back.
const STOP_BUTTON_DELAY = 300

// The stacked layout's console: its share of the height, remembered in the
// browser, a third at first.
const consoleShareStorageKey = 'glpython-console-share'
const CONSOLE_SHARE_MIN = 0.15
const CONSOLE_SHARE_MAX = 0.8
function storedConsoleShare(): number {
  try {
    const share = Number(localStorage.getItem(consoleShareStorageKey))
    return share >= CONSOLE_SHARE_MIN && share <= CONSOLE_SHARE_MAX ? share : 1 / 3
  } catch {
    return 1 / 3
  }
}

const animationsStorageKey = 'glpython-visualizer-animations'
const visualizerModeStorageKey = 'glpython-visualizer-mode'
const chainCommentsStorageKey = 'glpython-chain-comments'

// Copies text to the clipboard, falling back to the older selection-based
// way where the Clipboard API is unavailable or not allowed (e.g. an iframe
// without clipboard permission).
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      field.remove()
    }
  }
}

function storedVisualizerMode(): VisualizerMode {
  try {
    const stored = localStorage.getItem(visualizerModeStorageKey)
    return stored === 'box' || stored === 'tree' ? stored : 'substitution'
  } catch {
    return 'substitution'
  }
}

// One REPL input in the transcript below the program's output. `result` is
// filled in once the worker answers: what the input printed, then either its
// value (None included, see _glpython_repl), Python's last error line (and
// whether the input didn't even compile), or a hint that definitions belong
// in the file. `note` says why visualizing it didn't work.
type ReplEntry = {
  id: number
  source: string
  result: { output: string; value?: string; tree?: ValueTree; untraced?: boolean; error?: string; errorHint?: ErrorHint | null; hint?: 'definition' | null; unparsed?: boolean } | null
  note?: ReplReplayNote
  // What the input has printed so far, while it still runs.
  live?: string
  // From before Python was restarted (Stop): it can't be replayed anymore.
  stale?: boolean
}

// The console is one chronological transcript, like Python in a terminal:
// the program's output (see `output`), then in order every REPL input, Tests
// report and note (e.g. that Python was stopped). Run and Reset clear it.
type ConsoleEntry =
  | ({ kind: 'repl' } & ReplEntry)
  | { kind: 'tests'; id: number; report: TestReport }
  | { kind: 'note'; id: number; text: string }

// Monaco boxes characters that look like others and invisible ones. Not the
// typographic ones of a German text (dashes, quotes, ×), which Python rejects
// in code with a clear SyntaxError anyway; invisible ones stay marked
// everywhere, also in strings and comments - in a doctest's expected output a
// non-breaking space fails with an "Expected"/"Got" that look the same.
const EDITOR_UNICODE_HIGHLIGHT = {
  ambiguousCharacters: true,
  invisibleCharacters: true,
  includeStrings: true,
  includeComments: true,
  allowedCharacters: Object.fromEntries([...'\u2010\u2011\u2012\u2013\u2018\u2019\u201A\u201B\u2039\u203A\u00D7\u2032'].map((character) => [character, true])) as Record<string, true>,
}

// The console keeps the last part of a long output: a program printing in an
// endless loop must not fill the page's memory before it is stopped.
const CONSOLE_MAX_LENGTH = 100_000
function keepConsoleTail(text: string): string {
  return text.length <= CONSOLE_MAX_LENGTH ? text : `\u2026\n${text.slice(text.length - CONSOLE_MAX_LENGTH)}`
}

type ReplReplayNote = 'input' | 'differs'

// One highlighted (or plain) run of text within a single rendered line of a
// call-frame box - the plain-DOM equivalent of the inline decorations the
// main Monaco editor gets via deltaDecorations, since a box's content isn't
// a real Monaco model. A 'child' segment replaces its call site's own text
// entirely with a further-nested <CallFrameBox>, rendered inline exactly
// where that text sat (see childRanges in buildLineSegments below).
type LineSegment =
  | { kind: 'text'; text: string; className?: string; annotationNodeId?: number }
  // A nested box or inline call, or (frame null) the tree mode's tree.
  | { kind: 'child'; frame: OpenFrame | null }
  | { kind: 'group'; className: string; parts: Array<{ text: string; className?: string; annotationNodeId?: number }> }

function buildLineSegments(
  line: string,
  lineStart: number,
  // `nodeId`, when present, identifies exactly which AST node (e.g. a Call
  // node that just got substituted with its return value) this particular
  // highlight belongs to - carried through to a `data-annotation-node-id`
  // attribute below, so a connector/flight can anchor at one specific
  // substitution instead of just "the nearest one on this line" (see
  // nextStepReturnFlight's use of it further down).
  highlights: Array<{ start: number; end: number; nodeId?: number }>,
  // `param` marks a call box's "=value" next to a parameter name in its
  // header, which is styled more prominently than a loop variable's.
  annotationHighlights: Array<{ start: number; end: number; nodeId?: number; param?: boolean }>,
  childRanges: Array<{ start: number; end: number; frame: OpenFrame | null }>,
  nextStepRanges: Array<{ start: number; end: number }>,
  // The same box-drawing is reused for the failing node at an 'error' step
  // (which has no next step), just with its own class.
  nextStepClassName = 'visual-next-step',
): LineSegment[] {
  const lineEnd = lineStart + line.length
  // A child's own call-site range replaces its text wholesale, so any
  // highlight/annotation mark that falls entirely inside one (e.g. the
  // substituted "2" inside "fact(2)", while that call itself is still open
  // and rendered as a nested box, not yet collapsed into a plain value) is
  // dropped here - otherwise it would be re-inserted as leftover text after
  // the child segment already consumed that whole range.
  const insideChild = (start: number, end: number) => childRanges.some((c) => start >= c.start && end <= c.end)
  // `nextStep` is tracked as its own flag (rather than folded straight into
  // `className`) so that touching next-step marks can later be detected and
  // merged into one continuous box instead of leaving every mark to draw
  // its own outline - see the grouping pass below.
  const marks: Array<{ start: number; end: number; className?: string; child?: true; frame?: OpenFrame | null; continued?: true; nextStep?: boolean; annotationNodeId?: number }> = []
  for (const h of highlights) {
    if (insideChild(h.start, h.end)) continue
    const start = Math.max(h.start, lineStart)
    const end = Math.min(h.end, lineEnd)
    if (start < end) marks.push({ start: start - lineStart, end: end - lineStart, className: 'visual-substituted-value', annotationNodeId: h.nodeId })
  }
  for (const h of annotationHighlights) {
    if (insideChild(h.start, h.end)) continue
    const start = Math.max(h.start, lineStart)
    const end = Math.min(h.end, lineEnd)
    if (start < end) marks.push({ start: start - lineStart, end: end - lineStart, className: h.param ? 'visual-param-annotation' : 'visual-loop-annotation', annotationNodeId: h.nodeId })
  }
  for (const c of childRanges) {
    const start = Math.max(c.start, lineStart)
    const end = Math.min(c.end, lineEnd)
    // A child that started on an earlier line is drawn there only.
    if (start < end) marks.push({ start: start - lineStart, end: end - lineStart, child: true, frame: c.frame, continued: c.start < lineStart || undefined })
  }
  // The exact AST node the *next* trace step (not yet applied, since
  // rendering is always clamped to uptoStep) is about to evaluate/execute -
  // a preview of what's about to change, distinct from the dimmer
  // already-executed/current-line treatment above. It can partially overlap
  // an already-substituted/annotated sub-range (e.g. "3 <= 1" where "3" was
  // substituted by an earlier step but the comparison itself is what's next)
  // - that overlapping portion is still part of the box, so instead of
  // carving it out we just add the next-step class alongside its existing
  // one. Child-frame boxes are the one exception: they render as their own
  // nested component with no text span to attach a class to, so they're
  // carved out (and the whole range is skipped if it sits entirely inside
  // one, via the insideChild check below).
  const existingMarks = marks.slice()
  for (const r of nextStepRanges) {
    if (insideChild(r.start, r.end)) continue
    const start = Math.max(r.start, lineStart) - lineStart
    const end = Math.min(r.end, lineEnd) - lineStart
    if (start >= end) continue
    let cursor = start
    for (const m of existingMarks) {
      const mStart = Math.max(m.start, cursor)
      const mEnd = Math.min(m.end, end)
      if (mStart >= mEnd) continue
      if (m.child) {
        if (mStart > cursor) marks.push({ start: cursor, end: mStart, nextStep: true })
        cursor = Math.max(cursor, mEnd)
        continue
      }
      if (mStart > cursor) marks.push({ start: cursor, end: mStart, nextStep: true })
      m.nextStep = true
      cursor = Math.max(cursor, mEnd)
    }
    if (cursor < end) marks.push({ start: cursor, end, nextStep: true })
  }
  marks.sort((a, b) => a.start - b.start)

  // Touching next-step marks (e.g. an already-substituted "3" directly
  // followed by the plain "<= 1" that completes "3 <= 1") are merged into a
  // single group here so they render as one continuous highlighted box
  // instead of two dashed outlines meeting at a seam. Child-frame marks
  // never participate - they're their own nested component, not text.
  const grouped: Array<{ start: number; end: number; className?: string; child?: true; frame?: OpenFrame | null; continued?: true; nextStep?: boolean; annotationNodeId?: number; parts?: Array<{ start: number; end: number; className?: string; annotationNodeId?: number }> }> = []
  for (const mark of marks) {
    const prev = grouped[grouped.length - 1]
    if (mark.nextStep && !mark.child && prev && prev.nextStep && !prev.child && prev.end === mark.start) {
      if (!prev.parts) prev.parts = [{ start: prev.start, end: prev.end, className: prev.className, annotationNodeId: prev.annotationNodeId }]
      prev.parts.push({ start: mark.start, end: mark.end, className: mark.className, annotationNodeId: mark.annotationNodeId })
      prev.end = mark.end
      continue
    }
    grouped.push({ ...mark })
  }

  const segments: LineSegment[] = []
  let cursor2 = 0
  for (const mark of grouped) {
    if (mark.start > cursor2) segments.push({ kind: 'text', text: line.slice(cursor2, mark.start) })
    if (mark.child) {
      if (!mark.continued) segments.push({ kind: 'child', frame: mark.frame ?? null })
    } else if (mark.parts) {
      segments.push({ kind: 'group', className: nextStepClassName, parts: mark.parts.map((p) => ({ text: line.slice(p.start, p.end), className: p.className, annotationNodeId: p.annotationNodeId })) })
    } else {
      const className = mark.nextStep ? (mark.className ? `${mark.className} ${nextStepClassName}` : nextStepClassName) : mark.className
      segments.push({ kind: 'text', text: line.slice(mark.start, mark.end), className, annotationNodeId: mark.annotationNodeId })
    }
    cursor2 = mark.end
  }
  if (cursor2 < line.length || segments.length === 0) segments.push({ kind: 'text', text: line.slice(cursor2) })
  return segments
}

// A plain (un-substituted, un-annotated) run of source text is further
// split into syntax-colored runs here, using Monaco's own standalone Python
// tokenizer - so highlighting stays consistent with the real editor without
// a separate highlighting library. Substituted-value/annotation spans keep
// their own dedicated color instead (see the `className` branch below) and
// are never re-tokenized.
function TextSegment({ segment, monaco }: { segment: Extract<LineSegment, { kind: 'text' }>; monaco: Monaco | null }) {
  if (segment.className || !monaco || segment.text === '') return <ValueText text={segment.text} className={segment.className} annotationNodeId={segment.annotationNodeId} />
  const runs = tokenizePythonFragment(monaco, segment.text)
  return <>{runs.map((run, index) => <span key={index} className={run.className}>{run.text}</span>)}</>
}

// The full values behind the abbreviated texts shown at the current step
// (see fullValuesUpTo), and how to open one in FullValueDialog.
// With listtree, also the trees of the panel's values (see valueTreesUpTo),
// `showTrees` while its switch is on.
type FullValueAccess = { values: Map<string, FullValue>; trees: Map<string, ValueTree>; showTrees: boolean; open: (value: FullValue, name: string | null, tree?: ValueTree) => void; t: CoreStrings }
const FullValueContext = createContext<FullValueAccess | null>(null)

// A loop variable's annotation reads "=[1, 2, …, 100]".
function lookupFullValue(access: FullValueAccess | null, text: string): FullValue | null {
  if (!access || !text.includes('\u2026')) return null
  return access.values.get(text) ?? (text.startsWith('=') ? access.values.get(text.slice(1)) ?? null : null)
}

function openOnKey(event: KeyboardEvent, open: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  open()
}

// A substituted value or annotation in a line; an abbreviated one opens its
// full value. A span, not a button, so the line's text stays as it was. A
// long value is plain inline text, which wraps where the line ends.
const LONG_VALUE_LENGTH = 30
function ValueText({ text, className: baseClassName, annotationNodeId }: { text: string; className?: string; annotationNodeId?: number }) {
  const access = useContext(FullValueContext)
  const full = lookupFullValue(access, text)
  const className = text.length > LONG_VALUE_LENGTH && baseClassName?.includes('visual-substituted-value') ? `${baseClassName} visual-substituted-value--long` : baseClassName
  if (!access || !full) return <span className={className} data-annotation-node-id={annotationNodeId}>{text}</span>
  const open = () => access.open(full, null)
  return <span className={`${className ?? ''} visual-value-more visual-value-more-text`} data-annotation-node-id={annotationNodeId} role="button" tabIndex={0} title={access.t.visualizerShowFullValue ?? 'Show the full value'} onClick={open} onKeyDown={(event) => openOnKey(event, open)}>{text}</span>
}

function fullValueLength(value: FullValue, t: CoreStrings): string | null {
  if (value.length === null) return null
  return t.visualizerValueLength?.(value.length, value.kind) ?? `${value.length} ${value.kind === 'str' ? 'characters' : value.kind === 'dict' ? 'entries' : 'items'}`
}

// A variable in a frame's panel; an abbreviated value opens in full, with
// its length below it.
function LocalsValue({ name, value, className }: { name: string; value: string; className: string }) {
  const access = useContext(FullValueContext)
  const full = lookupFullValue(access, value)
  const tree = access?.showTrees ? access.trees.get(value) : undefined
  const treeNode = useMemo(() => tree ? treeFromValue(tree) : null, [tree])
  const text = !access || !full
    ? <span className={className}>{value}</span>
    : <span className={`${className} visual-value-more`} role="button" tabIndex={0} title={access.t.visualizerShowFullValue ?? 'Show the full value'} onClick={() => access.open(full, name, tree)} onKeyDown={(event) => openOnKey(event, () => access.open(full, name, tree))}><span className="visual-value-more-text">{value}</span>{fullValueLength(full, access.t) && <span className="locals-value-length">{fullValueLength(full, access.t)}</span>}</span>
  if (!access || !tree || !treeNode) return text
  // A tree too wide for the panel opens in the dialog instead.
  const openTree = () => access.open(full ?? { text: value, cut: false, length: null, kind: null }, name, tree)
  return <>{text}{layoutTree(treeNode).width <= LOCALS_TREE_WIDTH
    ? <span className="locals-tree"><TreeView tree={treeNode} label={value} /></span>
    : <span className="locals-tree locals-tree-more visual-value-more" role="button" tabIndex={0} onClick={openTree} onKeyDown={(event) => openOnKey(event, openTree)}>{access.t.showTree ?? 'Show tree'}</span>}</>
}

// The widest tree the variables panel shows itself, in characters.
const LOCALS_TREE_WIDTH = 48

// A long value in full, readable and scrollable.
function FullValueDialog({ value, name, tree, t, onClose }: { value: FullValue; name: string | null; tree?: ValueTree; t: CoreStrings; onClose: () => void }) {
  const treeNode = useMemo(() => tree ? treeFromValue(tree) : null, [tree])
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => previous?.focus()
  }, [])
  const title = t.visualizerFullValueTitle?.(name) ?? (name ?? 'Value')
  const length = fullValueLength(value, t)
  return (
    <div className="input-dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="input-dialog full-value-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
        <div className="input-dialog-heading"><span className="full-value-title">{title}</span>{length && <span className="full-value-length">{length}</span>}<button type="button" ref={closeRef} className="icon-button small full-value-close" aria-label={t.visualizerCloseFullValue ?? 'Close'} title={t.visualizerCloseFullValue ?? 'Close'} onClick={onClose}><X size={16} /></button></div>
        <pre className="full-value-text" tabIndex={0}>{value.text}{value.cut && '\u2026'}</pre>
        {value.cut && <p className="full-value-cut">{t.visualizerFullValueCut ?? 'Only the beginning of this value is shown.'}</p>}
        {treeNode && <div className="full-value-tree"><TreeView tree={treeNode} label={value.text} /></div>}
      </div>
    </div>
  )
}

// Which source span a Frame renders: the outermost module/global scope
// (the whole file, no single AST node to clip to) or one open user-defined
// function call (clipped to its own "def foo(...):" node).
// A third kind, 'inline', is a call shown in the substitution mode: just its
// return expression (see ShortForm), rendered as plain text at the call site
// rather than as a box.
type FrameScope =
  | { kind: 'module' }
  | { kind: 'call'; funcDefNodeId: number }
  | { kind: 'inline'; returnNodeId: number; parens: boolean }

// Where an inline (substitution-mode) call shows up as a line: the nearest
// enclosing box or module frame, and the lines of the outermost inline call
// in it - that line is highlighted while the call runs and gets the error
// message if the call fails, since inline text has no lines of its own.
type InlineHost = { frameId: number; path: string; line: number; endLine: number }

// What the visualizer shows at one step, apart from the trace itself: the
// open boxes (and the one about to open), what the next step declares, and
// where an inline call is drawn. The workspace computes it for the current
// step; SteadyHeightMeasure for other steps, to know their height.
type PendingCall = { openFrame: OpenFrame; argSources: string[] }
type StepView = {
  currentStep: TraceStep | null
  nextStep: TraceStep | null
  openFrames: Map<number, OpenFrame>
  pendingCall: PendingCall | null
  framesForRender: Map<number, OpenFrame>
  pendingCallLocals: { frameId: number; paramNames: string[] } | null
  collapsedCalls: CollapsedCalls | null
  declareTarget: { frameId: number; varName: string } | null
  isAtErrorStep: boolean
  isAtLastStep: boolean
  activeHost: InlineHost | null
  errorHost: InlineHost | null
  // In the tree mode, the expression tree open in each frame.
  activeTrees: Map<number, TreeEpisode>
}

// When the pending next step is a plain "x = ..." assignment or a
// "def f(...):" that's about to bind a name this frame doesn't have yet,
// which frame and name it's about to create (see Frame's `declareTarget`).
function declareTargetFor(steps: TraceStep[], currentStep: TraceStep | null, nextStep: TraceStep | null, astIndexByFile: Map<string, Map<number, AstNode>>) {
  if (!nextStep || nextStep.kind !== 'exec') return null
  const node = astIndexByFile.get(nextStep.path)?.get(nextStep.nodeId)
  if (!node) return null
  let varName: string | null = null
  if (node.type === 'FunctionDef') {
    varName = node.summary || null
  } else if (node.type === 'Assign') {
    const targets = node.fields.targets
    const onlyTarget = Array.isArray(targets) && targets.length === 1 ? targets[0] : null
    if (onlyTarget && typeof onlyTarget === 'object' && (onlyTarget as AstNode).type === 'Name') varName = (onlyTarget as AstNode).summary
  }
  if (!varName) return null
  const frameId = nextStep.frameId
  const currentLocals = buildLocalsUpTo(steps, currentStep?.step ?? -1, frameId)
  if (varName in currentLocals) return null
  return { frameId, varName }
}

// When the pending next step is a "call-enter", the callee frame's
// OpenFrame one step early (see `framesForRender` in the workspace).
function pendingCallFor(nextStep: TraceStep | null, substitutionMode: boolean): PendingCall | null {
  if (!nextStep || nextStep.kind !== 'call-enter') return null
  // A call shown as its return expression must not be replaced one step early.
  if (substitutionMode && nextStep.shortForm) return null
  if (nextStep.funcDefNodeId === null || nextStep.funcDefPath === null) return null
  const openFrame: OpenFrame = {
    frameId: nextStep.frameId,
    parentFrameId: nextStep.parentFrameId ?? 0,
    funcName: nextStep.func,
    anchorPath: nextStep.path,
    anchorNodeId: nextStep.nodeId,
    funcDefPath: nextStep.funcDefPath,
    funcDefNodeId: nextStep.funcDefNodeId,
    paramAnnotations: nextStep.paramAnnotations,
    shortForm: nextStep.shortForm ?? null,
  }
  return { openFrame, argSources: nextStep.argSources }
}

function framesWithPendingCall(openFrames: Map<number, OpenFrame>, pendingCall: PendingCall | null) {
  if (!pendingCall) return openFrames
  const merged = new Map(openFrames)
  merged.set(pendingCall.openFrame.frameId, pendingCall.openFrame)
  return merged
}

// Inline calls take no extra width, so only boxes count towards collapsing.
function collapsedCallsOf(framesForRender: Map<number, OpenFrame>, pendingCall: PendingCall | null, substitutionMode: boolean) {
  return collapseDeepCallChain(substitutionMode ? new Map([...framesForRender].filter(([, frame]) => !frame.shortForm)) : framesForRender, pendingCall ? 2 : 1)
}

// In the substitution mode, the line where an inline call (and the inline
// calls around it) is drawn.
function inlineHostIn(framesForRender: Map<number, OpenFrame>, astIndexByFile: Map<string, Map<number, AstNode>>, substitutionMode: boolean, frameId: number | undefined): InlineHost | null {
  if (!substitutionMode || frameId === undefined) return null
  let frame = framesForRender.get(frameId)
  if (!frame?.shortForm) return null
  for (let parent = framesForRender.get(frame.parentFrameId); parent?.shortForm; parent = framesForRender.get(frame.parentFrameId)) frame = parent
  const anchor = astIndexByFile.get(frame.anchorPath)?.get(frame.anchorNodeId)
  if (anchor?.line === undefined) return null
  return { frameId: frame.parentFrameId, path: frame.anchorPath, line: anchor.line, endLine: anchor.endLine ?? anchor.line }
}

// How many steps the embed measures ahead, and how many at a time (one
// batch per frame, so a long trace doesn't block the page).
const STEADY_HEIGHT_MEASURES = 120
const STEADY_HEIGHT_BATCH = 12

// The steps (indices into `steps`, -1 before the first) most likely to be
// the tallest, tallest first: every step of a short trace, else those with
// the most open calls (also the one about to open), later ones first, then
// some spread over the trace and its last step. Only their height counts.
function steadyHeightCandidates(trace: TraceStep[], steps: TraceStep[]): number[] {
  const depthAt = new Map<number, number>()
  let depth = 0
  for (const step of trace) {
    if (step.kind === 'call-enter') depth += 1
    if (step.closesFrameId !== null && step.closesFrameId !== undefined) depth -= 1
    depthAt.set(step.step, depth)
  }
  const depthOf = (index: number) => Math.max(index < 0 ? 0 : depthAt.get(steps[index].step) ?? 0, index + 1 < steps.length ? depthAt.get(steps[index + 1].step) ?? 0 : 0)
  const all = Array.from({ length: steps.length + 1 }, (_, index) => index - 1)
  const byDepth = [...all].sort((a, b) => depthOf(b) - depthOf(a) || b - a)
  if (all.length <= STEADY_HEIGHT_MEASURES) return byDepth
  const chosen = new Set(byDepth.slice(0, Math.round(STEADY_HEIGHT_MEASURES * 2 / 3)))
  chosen.add(steps.length - 1)
  const spread = STEADY_HEIGHT_MEASURES - chosen.size
  for (let index = 0; index < spread; index++) chosen.add(Math.floor((index * steps.length) / spread))
  return [...chosen].sort((a, b) => depthOf(b) - depthOf(a) || b - a)
}

// The view at the visualizer's step `index` (of `steps`, the mode's list).
function stepViewAt(trace: TraceStep[], steps: TraceStep[], index: number, astIndexByFile: Map<string, Map<number, AstNode>>, substitutionMode: boolean, treeEpisodes: TreeEpisode[] | null): StepView {
  const currentStep = steps[index] ?? null
  const nextStep = steps[index + 1] ?? null
  const lastStep = steps[steps.length - 1]
  const errorStep = lastStep?.kind === 'error' ? lastStep : null
  const isAtErrorStep = errorStep !== null && currentStep === errorStep
  const openFrames = computeOpenFramesUpTo(trace, currentStep?.step ?? -1)
  const pendingCall = pendingCallFor(nextStep, substitutionMode)
  const framesForRender = framesWithPendingCall(openFrames, pendingCall)
  return {
    currentStep,
    nextStep,
    openFrames,
    pendingCall,
    framesForRender,
    pendingCallLocals: pendingCall ? { frameId: pendingCall.openFrame.frameId, paramNames: pendingCall.argSources } : null,
    collapsedCalls: collapsedCallsOf(framesForRender, pendingCall, substitutionMode),
    declareTarget: declareTargetFor(steps, currentStep, nextStep, astIndexByFile),
    isAtErrorStep,
    isAtLastStep: steps.length > 0 && index === steps.length - 1,
    activeHost: inlineHostIn(framesForRender, astIndexByFile, substitutionMode, currentStep?.frameId),
    errorHost: isAtErrorStep && errorStep ? inlineHostIn(framesForRender, astIndexByFile, substitutionMode, errorStep.frameId) : null,
    activeTrees: treeEpisodes ? activeTreesAt(treeEpisodes, index) : new Map(),
  }
}

type FrameProps = {
  frameId: number
  path: string
  scope: FrameScope
  openFrames: Map<number, OpenFrame>
  nodeIndexByFile: Map<string, Map<number, AstNode>>
  visualSources: Record<string, string>
  trace: TraceStep[]
  uptoStep: number
  currentStep: TraceStep | null
  nextStep: TraceStep | null
  monaco: Monaco | null
  // The runtime's "function" / "class" / "module" descriptions mapped to
  // the UI language; any other value is shown exactly as Python wrote it.
  valueKindLabels: Record<string, string>
  // Per file, the comments and docstrings that call boxes leave out (see
  // TraceResult.hidden); the module frame shows the file as written.
  hiddenRanges: Record<string, Array<[number, number, number, number]>>
  // A name about to be assigned/defined by `nextStep` (a plain `x = ...`
  // or `def f(...):`) that doesn't exist in this frame's locals yet - shown
  // one step early as a valueless placeholder row, so an arrow can point
  // from the upcoming value/def in the code to where it's about to land.
  declareTarget: { frameId: number; varName: string } | null
  // Parameter names of a user-defined function call about to start running
  // (`nextStep.kind === 'call-enter'`) that don't have values yet - shown
  // one step early as valueless placeholder rows in that about-to-open
  // callee frame (itself already spliced in early via `openFrames`, see
  // `framesForRender`/`nextStepPendingCall`), so an arrow can point from
  // each argument's value at the call site into its own placeholder row.
  pendingCallLocals: { frameId: number; paramNames: string[] } | null
  // The trace's final 'error' step, only while it's the current step: its
  // node is marked red in its frame, with the message right below that line.
  errorStep: TraceStep | null
  // See collapseDeepCallChain - where the middle of a deep chain of boxes is
  // replaced by a marker, and the marker's text.
  collapsedCalls: CollapsedCalls | null
  collapsedCallsLabel: string
  // The visualizer's substitution mode (also in the tree mode), and the
  // note shown in the outermost box that's still drawn as a box in it
  // (`insideBox` is false there): why the call isn't replaced.
  substitutionMode: boolean
  boxHint: (reason: BoxReason | null, funcName: string) => ReactNode
  insideBox: boolean
  // The tree mode: the expression tree open in each frame, and the frames
  // open after any trace step (see episodeTreeLayout).
  trees: { active: Map<number, TreeEpisode>; framesAt: (step: number) => Map<number, OpenFrame> } | null
  // Set on an inline call that the next step (or the error) covers as a
  // whole, since it isn't text in its parent's line to mark directly.
  inlineMarkClass?: string
  activeHost: InlineHost | null
  errorHost: InlineHost | null
  // Only the module frame: a note shown under one of its lines (the doctest
  // expectation next to a failing example's final value).
  finalNote?: { line: number; text: string } | null
  // The hint shown below the error message (an ErrorHintNote), if any.
  errorHint?: ReactNode
}

// Renders one frame of execution - either the outermost module/global scope
// or one open user-defined function call anchored at its call site - as
// plain HTML driven directly by the trace/AST, instead of as Monaco overlay
// machinery. Every frame, however deeply nested, shares the exact same
// layout: its own source (with computed values substituted inline and its
// own current line highlighted) on the left, a thin divider, and its own
// variables panel on the right - all scoped to this exact invocation via
// its unique frame id, so recursive calls to the same function never mix up
// each other's displayed state. Any further-nested open call inside this
// frame's body renders its own Frame recursively, inline, right at its own
// call site - real DOM in normal flow, so surrounding text/lines reflow
// automatically.
function Frame(props: FrameProps) {
  const { frameId, path, scope, errorHint, openFrames, nodeIndexByFile, visualSources, trace, uptoStep, currentStep, nextStep, monaco, valueKindLabels, hiddenRanges, declareTarget, pendingCallLocals, errorStep, collapsedCalls, collapsedCallsLabel, substitutionMode, boxHint, insideBox, inlineMarkClass, activeHost, errorHost, finalNote, trees } = props
  const nodeIndex = nodeIndexByFile.get(path)
  const source = visualSources[path]
  if (!nodeIndex || source === undefined) return null

  const lineOffsets = computeLineOffsets(source)
  let clipRange: { start: number; end: number } | null = null
  if (scope.kind !== 'module') {
    const clipNode = nodeIndex.get(scope.kind === 'call' ? scope.funcDefNodeId : scope.returnNodeId)
    if (!clipNode) return null
    clipRange = nodeRange(clipNode, lineOffsets)
    if (!clipRange) return null
  }
  const startLine = lineNumberAtOffset(lineOffsets, clipRange?.start ?? 0)

  const openFrame = frameId !== 0 ? openFrames.get(frameId) : undefined
  let substitutions = buildSubstitutionsUpTo(trace, uptoStep, frameId).get(path)
  // An inline call shows every parameter already replaced by its value.
  if (scope.kind === 'inline' && openFrame?.shortForm) {
    substitutions = new Map([...openFrame.shortForm.paramValues, ...(substitutions ?? [])])
  }
  const annotations = new Map(buildAnnotationsUpTo(trace, uptoStep, frameId).get(path) ?? [])
  // A box's header shows each parameter's value ("def f(n=3):"); an inline
  // call has no header, its parameters are already replaced by their values.
  if (openFrame && scope.kind !== 'inline') for (const [nodeId, text] of openFrame.paramAnnotations) annotations.set(nodeId, text)
  const paramNodeIds = new Set(openFrame?.paramAnnotations.map(([nodeId]) => nodeId))

  // A call box shows the function without its comments and docstring.
  // Nor a parameter's default: its header shows the value of this call.
  const removals = scope.kind === 'call' && clipRange ? hiddenRangesWithin([...hiddenRanges[path] ?? [], ...(openFrame?.paramAnnotations ?? []).flatMap(([, , , range]) => range ? [range] : [])], lineOffsets, source.length, clipRange) : []
  const rendered = renderFrameSource(source, lineOffsets, nodeIndex, clipRange, substitutions, annotations, removals)
  if (!rendered) return null
  // Must match how renderFrameSource placed the substitutions.
  const substitutionContext = { source, limit: clipRange, removals }
  // The original line number of each rendered line, skipping removed lines.
  const hiddenLines = removedLines(removals, lineOffsets, source.length)
  const shownLines: number[] = []
  for (let line = startLine; shownLines.length < rendered.text.split('\n').length && line <= lineOffsets.length; line++) {
    if (!hiddenLines.has(line)) shownLines.push(line)
  }

  const executedLines = buildExecutedLinesUpTo(trace, uptoStep, frameId, nodeIndexByFile).get(path)

  const children = [...openFrames.values()].filter((f) => f.parentFrameId === frameId)
  const isFrameActive = currentStep?.frameId === frameId
  const clipStart = clipRange?.start ?? 0

  // Every further-nested open call inside this frame's own body, mapped to
  // where its own call-site text (e.g. "fact(2)") ends up within this
  // frame's *own* rendered text (already-clipped to clipRange, exactly
  // matching rendered.text's coordinates) - so it can be spliced inline,
  // replacing that text, instead of appended as a separate row below it.
  // This includes a call whose own call hasn't actually started yet (the
  // one-step-early preview frame from `nextStepPendingCall`) - its call
  // site is swallowed just like any other child's, since the substituted
  // value it would have shown is instead rendered one step early inside
  // its own box's header (see nextStepPendingCall/paramAnnotations).
  const childRanges: Array<{ start: number; end: number; frame: OpenFrame | null }> = []
  for (const child of children) {
    const anchorNode = child.anchorPath === path ? nodeIndex.get(child.anchorNodeId) : undefined
    if (!anchorNode) continue
    const range = locateNodeRenderedRange(lineOffsets, nodeIndex, substitutions, annotations, anchorNode, false, substitutionContext)
    if (!range) continue
    childRanges.push({ start: range.start - clipStart, end: range.end - clipStart, frame: child })
  }

  // The tree mode: the expression being evaluated in this frame drawn as its
  // tree in its place - with the calls in it, which the tree shows (inline
  // calls) or hangs below it (boxes).
  const episode = trees?.active.get(frameId)
  const treeRoot = episode && episode.path === path ? nodeIndex.get(episode.rootNodeId) : undefined
  const treeRange = treeRoot ? locateNodeRenderedRange(lineOffsets, nodeIndex, substitutions, annotations, treeRoot, false, substitutionContext) : null
  let expressionTree: { tree: TreeNode; layout: TreeLayout; text: string; boxes: OpenFrame[] } | null = null
  if (trees && episode && treeRange) {
    const context = { trace, nodeIndexByFile, sources: visualSources, openFrames, framesAt: trees.framesAt, nextKey: treeKeyOf(nextStep), errorKey: treeKeyOf(errorStep) }
    const built = buildExpressionTree(context, episode, uptoStep)
    if (built) {
      expressionTree = { ...built, layout: episodeTreeLayout(context, episode, uptoStep, built.tree) }
      const start = treeRange.start - clipStart
      const end = treeRange.end - clipStart
      for (let index = childRanges.length - 1; index >= 0; index--) if (childRanges[index].start >= start && childRanges[index].end <= end) childRanges.splice(index, 1)
      childRanges.push({ start, end, frame: null })
    }
  }

  // The AST node the *next* trace step (uptoStep + 1) will touch, if that
  // step belongs to this exact frame - so the learner can see exactly the
  // span of code that's about to be mutated/replaced before clicking
  // "next" (e.g. just the one name about to be substituted, or the one
  // sub-expression about to be reduced to its result). A "call-enter" step
  // is special: its own frameId is the *new* callee frame (which doesn't
  // exist as an open Frame yet), while its nodeId/path describe the
  // call-site sitting in the *caller* frame instead - so it's matched
  // against parentFrameId.
  const nextStepFrameId = nextStep == null ? null : nextStep.kind === 'call-enter' ? (nextStep.parentFrameId ?? 0) : nextStep.frameId
  const nextStepRanges = nextStep !== null && nextStepFrameId === frameId && nextStep.path === path
    ? (() => {
        const nextNode = nodeIndex.get(nextStep.nodeId)
        if (!nextNode) return []
        const range = locateNodeRenderedRange(lineOffsets, nodeIndex, substitutions, annotations, nextNode, true, substitutionContext)
        if (!range) return []
        return [{ start: range.start - clipStart, end: range.end - clipStart }]
      })()
    : []

  const isErrorFrame = errorStep !== null && errorStep.frameId === frameId && errorStep.path === path
  const errorRanges = isErrorFrame
    ? (() => {
        const errorNode = nodeIndex.get(errorStep.nodeId)
        if (!errorNode) return []
        const range = locateNodeRenderedRange(lineOffsets, nodeIndex, substitutions, annotations, errorNode, false, substitutionContext)
        if (!range) return []
        const start = range.start - clipStart
        const end = range.end - clipStart
        // An inline call failing in its "return" statement itself marks its
        // whole expression - that's all of the statement it shows.
        if (scope.kind === 'inline' && (start < 0 || end > rendered.text.length)) return [{ start: 0, end: rendered.text.length }]
        return [{ start, end }]
      })()
    : []

  const isModule = scope.kind === 'module'
  const annotationHighlights = rendered.annotationHighlights.map((h) => ({ ...h, param: h.nodeId !== undefined && paramNodeIds.has(h.nodeId) }))
  const lines = rendered.text.split('\n')
  let cursor = 0
  const localEntries: Array<[string, string | null]> = Object.entries(buildLocalsUpTo(trace, uptoStep, frameId))
  if (declareTarget && declareTarget.frameId === frameId && !localEntries.some(([name]) => name === declareTarget.varName)) {
    localEntries.push([declareTarget.varName, null])
  }
  if (pendingCallLocals && pendingCallLocals.frameId === frameId) {
    for (const paramName of pendingCallLocals.paramNames) {
      if (!localEntries.some(([name]) => name === paramName)) localEntries.push([paramName, null])
    }
  }

  // Children of a box (or of an inline call inside one) are inside a box.
  const childFrameProps = { errorHint, openFrames, nodeIndexByFile, visualSources, trace, uptoStep, currentStep, nextStep, monaco, valueKindLabels, hiddenRanges, declareTarget, pendingCallLocals, errorStep, collapsedCalls, collapsedCallsLabel, substitutionMode, boxHint, activeHost, errorHost, trees, insideBox: insideBox || scope.kind === 'call' }
  const markedRanges = errorRanges.length > 0 ? errorRanges : nextStepRanges
  const inlineMarkFor = (frame: OpenFrame) => {
    const range = childRanges.find((child) => child.frame?.frameId === frame.frameId)
    if (!range || !markedRanges.some((marked) => marked.start <= range.start && marked.end >= range.end)) return undefined
    return errorRanges.length > 0 ? 'visual-error-node' : 'visual-next-step'
  }
  const renderChild = (frame: OpenFrame, segmentIndex: number): ReactNode => collapsedCalls?.firstHiddenFrameId === frame.frameId ? (
    <span key={segmentIndex} className="frame-child-zone">
      <span className="frame-collapsed-calls">
        <span className="frame-collapsed-calls-label">{collapsedCallsLabel}</span>
        <Frame
          key={collapsedCalls.resumeFrame.frameId}
          frameId={collapsedCalls.resumeFrame.frameId}
          path={collapsedCalls.resumeFrame.funcDefPath}
          scope={{ kind: 'call', funcDefNodeId: collapsedCalls.resumeFrame.funcDefNodeId }}
          {...childFrameProps}
          insideBox
        />
      </span>
    </span>
  ) : substitutionMode && frame.shortForm ? (
    <Frame
      key={segmentIndex}
      frameId={frame.frameId}
      path={frame.funcDefPath}
      scope={{ kind: 'inline', returnNodeId: frame.shortForm.returnNodeId, parens: frame.shortForm.parens }}
      inlineMarkClass={inlineMarkFor(frame)}
      {...childFrameProps}
    />
  ) : (
    <span key={segmentIndex} className="frame-child-zone">
      <Frame
        frameId={frame.frameId}
        path={frame.funcDefPath}
        scope={{ kind: 'call', funcDefNodeId: frame.funcDefNodeId }}
        {...childFrameProps}
      />
    </span>
  )
  const renderSegments = (segments: LineSegment[]): ReactNode[] => segments.map((segment, segmentIndex) => segment.kind === 'child' && segment.frame === null ? (
    expressionTree && (
      <ExpressionTreeBox key={segmentIndex} tree={expressionTree.tree} layout={expressionTree.layout} label={expressionTree.text}>
        {expressionTree.boxes.length > 0 && renderSegments(expressionTree.boxes.map((frame) => ({ kind: 'child', frame })))}
      </ExpressionTreeBox>
    )
  ) : segment.kind === 'child' ? renderChild(segment.frame!, segmentIndex) : segment.kind === 'group' ? (

    <span key={segmentIndex} className={segment.className}>
      {segment.parts.map((part, partIndex) => <ValueText key={partIndex} text={part.text} className={part.className} annotationNodeId={part.annotationNodeId} />)}
    </span>
  ) : (
    <TextSegment key={segmentIndex} segment={segment} monaco={monaco} />
  ))
  const lineSegments = (line: string, lineStart: number) => errorRanges.length > 0
    ? buildLineSegments(line, lineStart, rendered.highlights, annotationHighlights, childRanges, errorRanges, 'visual-error-node')
    : buildLineSegments(line, lineStart, rendered.highlights, annotationHighlights, childRanges, nextStepRanges)

  if (scope.kind === 'inline') {
    // Parentheses only while the expression hasn't become a single value yet.
    const returnNode = nodeIndex.get(scope.returnNodeId)
    const isSingleValue = substitutions?.has(scope.returnNodeId) === true || returnNode?.type === 'Constant'
    const parens = scope.parens && !isSingleValue
    return (
      <span className={`frame-inline${inlineMarkClass ? ` ${inlineMarkClass}` : ''}`} data-inline-frame-id={frameId}>
        {parens && '('}
        {lines.map((line, index) => {
          const lineStart = cursor
          cursor += line.length + 1
          return <Fragment key={index}>{index > 0 && '\n'}{renderSegments(lineSegments(line, lineStart))}</Fragment>
        })}
        {parens && ')'}
      </span>
    )
  }

  const showBoxHint = substitutionMode && scope.kind === 'call' && !insideBox
  const boxReason = showBoxHint ? trace.find((step) => step.kind === 'call-enter' && step.frameId === frameId)?.boxReason ?? null : null
  return (
    <div className={`frame-box${isModule ? ' frame-box--root' : ''}`} data-frame-id={frameId}>
      <div className="frame-code">
        {showBoxHint && openFrame && <div className="frame-hint" data-box-reason={boxReason ?? undefined}>{boxHint(boxReason, openFrame.funcName)}</div>}
        {lines.map((line, index) => {
          const lineStart = cursor
          cursor += line.length + 1
          const absoluteLine = shownLines[index] ?? startLine + index
          const isHostLine = (host: InlineHost | null, hostLine: 'line' | 'endLine') => host !== null && host.frameId === frameId && host.path === path && host[hostLine] === absoluteLine
          const isCurrentLine = (isFrameActive && currentStep?.line === absoluteLine) || isHostLine(activeHost, 'line')
          const isExecutedLine = !isCurrentLine && executedLines?.has(absoluteLine) === true
          const isErrorLine = isCurrentLine && (isErrorFrame || isHostLine(errorHost, 'line'))
          const lineStateClass = isErrorLine ? ' visual-current-line visual-error-line' : isCurrentLine ? ' visual-current-line' : isExecutedLine ? ' visual-executed-line' : ''
          const content = renderSegments(lineSegments(line, lineStart))
          // Python's own message for the failing node, directly below the
          // last line of that node (or of the inline call it failed in).
          const errorMessage = errorStep !== null && ((isErrorFrame && errorStep.endLine === absoluteLine) || isHostLine(errorHost, 'endLine'))
            ? <div className="visual-error-message" role="alert">{errorStep.label}</div>
            : null
          // Only the outermost module frame shows a line-number gutter,
          // matching how Monaco only ever showed line numbers for the main
          // editor and never inside a nested box. The gutter number lives
          // in the same row as its line's content (rather than a separate
          // fixed-height column) so it still lines up correctly even when
          // an embedded nested frame makes that one logical line visually
          // taller than a plain line of text.
          if (isModule) {
            return (
              <Fragment key={index}>
                <div className={`frame-line-row${lineStateClass}`}>
                  <span className="frame-gutter-num">{absoluteLine}</span>
                  <div className={`frame-line${lineStateClass}`}>{content}</div>
                </div>
                {errorMessage && <div className="frame-line-row"><span className="frame-gutter-num" />{errorMessage}</div>}
                {errorMessage && errorHint && <div className="frame-line-row"><span className="frame-gutter-num" /><div className="visual-error-hint">{errorHint}</div></div>}
                {finalNote && finalNote.line === absoluteLine && <div className="frame-line-row"><span className="frame-gutter-num" /><div className="visual-expectation-message" role="status">{finalNote.text}</div></div>}
              </Fragment>
            )
          }
          return (
            <Fragment key={index}>
              <div className={`frame-line${lineStateClass}`}>{content}</div>
              {errorMessage}
              {errorMessage && errorHint && <div className="visual-error-hint">{errorHint}</div>}
            </Fragment>
          )
        })}
      </div>
      {/* The variables panel only when there are variables to show. */}
      {localEntries.length > 0 && <>
        <div className="frame-divider" />
        <div className="frame-vars">
          {localEntries.map(([name, value]) => <div className="locals-row" key={name} data-name={name}><span className="locals-name">{name}</span>{value === null ? <span className="locals-value locals-value-pending" key="pending">{'\u2026'}</span> : Object.hasOwn(valueKindLabels, value) ? <span className="locals-value locals-value-kind" key={value}>{valueKindLabels[value]}</span> : <LocalsValue key={value} name={name} value={value} className="locals-value" />}</div>)}
        </div>
      </>}
    </div>
  )
}

// The tree mode's tree in a code line, at the place of its expression, with
// the boxes of the calls in it below. It is at most as wide as the
// visualizer shows from where it starts, so a wide tree scrolls in itself
// (TreeView: root centred, hints at the hidden edges) instead of widening
// the canvas.
function ExpressionTreeBox({ tree, layout, label, children }: { tree: TreeNode; layout: TreeLayout; label: string; children?: ReactNode }) {
  const viewRef = useRef<HTMLSpanElement>(null)
  const [maxWidth, setMaxWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = viewRef.current
    const container = element?.closest<HTMLElement>('.visualizer-measure') ?? element?.closest<HTMLElement>('.visualizer-view')
    if (!element || !container) return
    const update = () => {
      const offset = element.getBoundingClientRect().left - container.getBoundingClientRect().left + container.scrollLeft
      const width = Math.max(TREE_MIN_WIDTH, Math.floor(container.clientWidth - offset - TREE_END_MARGIN))
      setMaxWidth((previous) => previous === width ? previous : width)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])
  return (
    <span className="frame-tree">
      <span className="frame-tree-view" ref={viewRef} style={maxWidth ? { maxWidth } : undefined}>
        <TreeView tree={tree} layout={layout} label={label} animate />
      </span>
      {children && <span className="frame-tree-boxes">{children}</span>}
    </span>
  )
}

// The narrowest a tree gets in a line, and the room it leaves at the
// visualizer's right edge, in pixels.
const TREE_MIN_WIDTH = 160
const TREE_END_MARGIN = 16

// An element's position within the visualizer canvas, from layout offsets
// rather than getBoundingClientRect: a box that just opened is still scaled
// down by its "visual-frame-grow" animation when it's measured.
function canvasOffset(element: HTMLElement, canvas: HTMLElement): { left: number; top: number } {
  let left = 0
  let top = 0
  for (let node: HTMLElement | null = element; node && node !== canvas; node = node.offsetParent as HTMLElement | null) {
    left += node.offsetLeft
    top += node.offsetTop
  }
  return { left, top }
}

// The doctest report in the output panel: a summary, glpython's hints, and
// every failing example in doctest's own words with a button to visualize it.
// The visualizer bar's «⋯ Options» menu. It opens like any button (click,
// Enter, Space) and moves the focus to its first item; the arrow keys move
// between the items; Escape closes it and returns the focus to the button,
// as does a click outside or Tab (without moving the focus back).
function OptionsMenu({ label, children }: { label: string; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])]

  useEffect(() => {
    if (!isOpen) return
    items()[0]?.focus()
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setIsOpen(false)
    }
    // In an iframe, a click on the host page only shows as the window losing
    // the focus.
    const closeOnBlur = () => setIsOpen(false)
    document.addEventListener('pointerdown', closeOutside)
    window.addEventListener('blur', closeOnBlur)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('blur', closeOnBlur)
    }
  }, [isOpen])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen) return
    if (event.key === 'Escape') {
      event.preventDefault()
      setIsOpen(false)
      buttonRef.current?.focus()
    } else if (event.key === 'Tab') {
      setIsOpen(false)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const list = items()
      const index = list.indexOf(document.activeElement as HTMLElement)
      list[(index + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus()
    }
  }

  return (
    <div className="visualizer-options" onKeyDown={onKeyDown}>
      <button ref={buttonRef} type="button" className="secondary-button visualizer-options-button" aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}><Ellipsis size={15} aria-hidden="true" /> {label}</button>
      {isOpen && <div ref={menuRef} className="visualizer-options-menu" role="menu" aria-label={label}>{children}</div>}
    </div>
  )
}

function TestReportView({ report, t, onVisualizeExample }: { report: TestReport; t: CoreStrings; onVisualizeExample: ((failure: NonNullable<TestReport['failures']>[number]) => void) | null }) {
  if (report.error) return <div className="test-report"><p className="output-error">{t.testsLoadError?.(report.error) ?? `The file could not be loaded: ${report.error}`}</p><ErrorHintNote hint={report.errorHint} t={t} /></div>
  if (report.examplesError) return <div className="test-report"><p className="output-error">{t.testsExamplesError?.(report.examplesError) ?? `The examples could not be read: ${report.examplesError}`}</p><ErrorHintNote hint={report.errorHint} t={t} /></div>
  const attempted = report.attempted ?? 0
  const failed = report.failed ?? 0
  return (
    <div className="test-report">
      {report.output ? <pre className="test-output">{report.output.replace(/\n$/, '')}</pre> : null}
      <p className={`test-summary${failed > 0 ? ' test-summary--failed' : attempted > 0 ? ' test-summary--passed' : ''}`}>
        {attempted === 0 ? (t.testsNone ?? 'No examples found in docstrings.') : (t.testsSummary?.(attempted - failed, attempted) ?? `${attempted - failed} of ${attempted} examples passed`)}
      </p>
      {(report.printHints ?? []).map((hint, index) => <p className="test-hint" key={index}>{t.testsPrintHint?.(hint.source, hint.output) ?? `Note: ${hint.source} printed ${hint.output}, but returned None.`}</p>)}
      {failed === 0 && attempted > 0 && report.uncovered && <TestCoverageView gaps={report.uncovered} t={t} />}
      {(report.failures ?? []).map((failure, index) => (
        <div className="test-failure" key={index}>
          <pre>{failure.text.replace(/^\*+\n/, '').replace(/^\n+|\n+$/g, '')}</pre>
          <ErrorHintNote hint={failure.errorHint} t={t} />
          {onVisualizeExample && <button type="button" className="secondary-button" onClick={() => onVisualizeExample(failure)}><Workflow size={13} /> {t.visualizeExample ?? 'Visualize example'}</button>}
        </div>
      ))}
    </div>
  )
}

// Coverage after Tests that all passed: the lines no example executed, each
// with its code, or an informative note when every line ran.
function TestCoverageView({ gaps, t }: { gaps: CoverageGap[]; t: CoreStrings }) {
  if (gaps.length === 0) return <p className="test-coverage test-coverage--complete" role="note">{t.testsAllCovered ?? 'Every line of the functions was run by at least one example. This doesn\'t show whether the examples also check the edge cases.'}</p>
  const label = (gap: CoverageGap) => t.testsUncoveredLines?.(gap.start, gap.end) ?? (gap.start === gap.end ? `Line ${gap.start}:` : `Lines ${gap.start}\u2013${gap.end}:`)
  return (
    <div className="test-coverage" role="note">
      <p className="test-coverage-heading">{t.testsUncoveredHeading ?? 'Not run by any example:'}</p>
      <ul>{gaps.map((gap) => <li key={gap.start}>{gap.code.includes('\n') ? <>{label(gap)}<pre><code>{gap.code}</code></pre></> : <>{label(gap)} <code>{gap.code}</code></>}</li>)}</ul>
    </div>
  )
}

// The hint below an error (hints.py), worded by CoreStrings.errorHint, with
// the names in it as code. Python's message above it stays as it is.
function ErrorHintNote({ hint, t, context = 'other' }: { hint: ErrorHint | null | undefined; t: CoreStrings; context?: ErrorHintContext }) {
  const text = hint ? t.errorHint?.(hint, context) : null
  if (!text) return null
  return <span className="error-hint" role="note"><strong>{t.hintLabel ?? 'Hint:'}</strong> {text.split('`').map((part, index) => index % 2 === 1 ? <code key={index}>{part}</code> : part)}</span>
}

// `onVisualize` is set when the entry can be visualized: it ran (an error
// included, which the visualization ends with), and it compiled; `busy`
// while Python is running something.
// With `listTree`, a value that reads as a tree has a «Baum» button that
// shows the tree below it.
function ReplTranscriptEntry({ entry, definitionHint, t, onVisualize, busy, listTree }: { entry: ReplEntry; definitionHint: string; t: CoreStrings; onVisualize?: () => void; busy: boolean; listTree: boolean }) {
  const result = entry.result
  const printed = (result ? result.output : entry.live ?? '').replace(/\n$/, '')
  const visualizeLabel = t.replVisualizeEntry ?? 'Visualize'
  const treeLabel = t.replShowTree ?? 'Tree'
  const [isTreeShown, setIsTreeShown] = useState(false)
  const tree = listTree && result?.value !== undefined ? result.tree : undefined
  const treeNode = useMemo(() => tree ? treeFromValue(tree) : null, [tree])
  return (
    <span className="repl-entry">
      <span className="repl-echo"><span>{'>>> '}{entry.source}</span>{treeNode && <button type="button" className="repl-entry-tree" onClick={() => setIsTreeShown((shown) => !shown)} aria-pressed={isTreeShown} aria-label={`${treeLabel}: ${entry.source}`}>{treeLabel}</button>}{onVisualize && <button type="button" className="repl-entry-visualize" onClick={onVisualize} disabled={busy} aria-label={`${visualizeLabel}: ${entry.source}`}>{visualizeLabel}</button>}</span>
      {printed && <span>{printed}</span>}
      {result?.value !== undefined && <span className="repl-value">{result.value}</span>}
      {treeNode && isTreeShown && <span className="repl-tree"><TreeView tree={treeNode} label={result?.value ?? ''} /></span>}
      {result?.error && <span className="output-error">{result.error}</span>}
      <ErrorHintNote hint={result?.errorHint} t={t} context="repl" />
      {result?.hint === 'definition' && <span className="repl-hint">{definitionHint}</span>}
      {entry.note && <span className="repl-note" role="note">{t.replReplayNote?.(entry.note) ?? (entry.note === 'input' ? "Can't be visualized: the history up to here uses input()." : "Can't be visualized: replaying the history gave a different result.")}</span>}
    </span>
  )
}

function GlPythonWorkspace(props: GlPythonWorkspaceProps) {
  const {
    project,
    activeFile,
    openFiles,
    onOpenFile,
    onCloseFile,
    onFileCodeChange,
    isGraphicsOpen,
    onGraphicsOpenChange,
    t,
    capabilities,
    compact = false,
    command = null,
    visualizerMode: visualizerModePreset,
    onBusyChange,
    actionsContainer = null,
    renderMarkdown,
  } = props
  const workspaceCapabilities = { ...defaultWorkspaceCapabilities, ...capabilities }
  const [output, setOutput] = useState(() => t.readyOutput)
  // The hint for the error the last Run ended with (hints.py), shown below
  // Python's traceback.
  const [outputErrorHint, setOutputErrorHint] = useState<ErrorHint | null>(null)
  // Whether Pyodide is still loading, ready, or failed to load: the runtime
  // badge only shows while it isn't ready.
  const [runtimeState, setRuntimeState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [graphics, setGraphics] = useState<TurtleCommand[]>([])
  const [isRunning, setIsRunning] = useState(false)
  // input(): the prompt while the program waits for a line (the console's
  // input line asks for it), and the lines answered since, shown until the
  // program's own output - which repeats them, as a terminal does - arrives.
  const [inputRequest, setInputRequest] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [answeredInputLines, setAnsweredInputLines] = useState<string[]>([])
  const [isVisualizerLoading, setIsVisualizerLoading] = useState(false)
  const [visualTrace, setVisualTrace] = useState<TraceResult | null>(null)
  const [visualSources, setVisualSources] = useState<Record<string, string>>({})
  // -1 is the "before execution" state - nothing substituted, no output, no
  // locals, no current line highlighted - shown right after a trace loads
  // and reachable again via restart/stepping back from the first step.
  const [visualStepIndex, setVisualStepIndex] = useState(-1)
  // Whether step transitions (highlight/background fades, new frames and
  // local rows easing in, value-change flashes) are animated or applied
  // instantly - persisted like the locale choice, defaulting to on.
  const [animationsEnabled, setAnimationsEnabled] = useState<boolean>(() => localStorage.getItem(animationsStorageKey) !== 'false')
  const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>(() => visualizerModePreset ?? storedVisualizerMode())
  const [chainComments, setChainComments] = useState<boolean>(() => {
    try { return localStorage.getItem(chainCommentsStorageKey) !== 'false' } catch { return true }
  })
  const [chainFeedback, setChainFeedback] = useState<'copied' | 'failed' | null>(null)
  // «Baum» only with its capability; else the substitution mode shows.
  const effectiveMode: VisualizerMode = visualizerMode === 'tree' && !workspaceCapabilities.tree ? 'substitution' : visualizerMode
  // The tree mode shows calls as the substitution mode does.
  const substitutionMode = effectiveMode !== 'box'
  const treeMode = effectiveMode === 'tree'
  const valueKindLabels = useMemo(() => ({
    function: t.valueKindFunction ?? 'function',
    class: t.valueKindClass ?? 'class',
    module: t.valueKindModule ?? 'module',
  }), [t])
  // The abbreviated value shown in full (FullValueDialog), with its variable's name.
  const [fullValueView, setFullValueView] = useState<{ value: FullValue; name: string | null; tree?: ValueTree } | null>(null)
  // The options menu's «Listen als Baum zeigen» (with listTree).
  const [showListTrees, setShowListTrees] = useState(true)
  // While a failing doctest example is visualized: the texts doctest compared.
  const [exampleExpectation, setExampleExpectation] = useState<{ got: string; want: string } | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  // Every submitted input, oldest first, for arrow up/down.
  // Unlike the transcript it survives a Run.
  const [replHistory, setReplHistory] = useState<string[]>([])
  const [replHistoryIndex, setReplHistoryIndex] = useState<number | null>(null)
  const [replInput, setReplInput] = useState('')
  const [isReplBusy, setIsReplBusy] = useState(false)
  const replIdRef = useRef(0)
  // Set at a stop, so the next worker's "ready" doesn't clear the console;
  // and whether the running program has printed anything yet (its first
  // output replaces the «… wird ausgeführt» line).
  // A console entry a click asked for (a Tests report, a REPL input, the
  // stop note): shown as soon as it is there, see the console's scroll effect.
  const revealEntryRef = useRef<number | null>(null)
  // Whether the console is scrolled to its end (set by its onScroll).
  const consoleAtBottomRef = useRef(true)
  const keepConsoleOnReadyRef = useRef(false)
  const runStreamStartedRef = useRef(false)
  // Streamed output waiting to be shown: applied together every 40 ms rather
  // than one render per printed line.
  const streamedOutputRef = useRef<Array<{ id: number | undefined; text: string }>>([])
  const streamFlushTimerRef = useRef<number | null>(null)
  const flushStreamedOutput = () => {
    streamFlushTimerRef.current = null
    const chunks = streamedOutputRef.current
    streamedOutputRef.current = []
    const program = chunks.filter((chunk) => chunk.id === undefined).map((chunk) => chunk.text).join('')
    if (program) {
      const append = runStreamStartedRef.current
      runStreamStartedRef.current = true
      setOutput((current) => keepConsoleTail(append ? current + program : program))
    }
    const byInput = new Map<number, string>()
    for (const chunk of chunks) if (chunk.id !== undefined) byInput.set(chunk.id, (byInput.get(chunk.id) ?? '') + chunk.text)
    if (byInput.size > 0) setConsoleEntries((entries) => entries.map((entry) => entry.kind === 'repl' && !entry.result && byInput.has(entry.id) ? { ...entry, live: keepConsoleTail((entry.live ?? '') + byInput.get(entry.id)) } : entry))
    if (chunks.length > 0) setAnsweredInputLines([])
  }
  const replSourcesRef = useRef(new Map<number, string>())
  const outputRef = useRef<HTMLDivElement | null>(null)
  // Set while the visualizer shows a REPL input rather than a project file:
  // the path its own pseudo-file is traced under (see REPL_PATH in the worker).
  const [visualRootPath, setVisualRootPath] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const inputFieldRef = useRef<HTMLInputElement | null>(null)
  // Monaco's own namespace, obtained independent of whether any <Editor> is
  // currently mounted (it loads/caches lazily the first time any component
  // asks for it) - used only to run its standalone Python tokenizer for
  // syntax coloring in the plain-HTML visualizer view below; the real
  // Monaco <Editor> for normal editing is untouched by any of this.
  const monaco = useMonaco()
  // Scrollable container for the plain-HTML visualizer view, used to keep
  // the currently executing line in view as steps advance (see the
  // auto-scroll effect below) with ordinary DOM scrolling instead of
  // Monaco's view-zone/content-widget machinery.
  const visualizerScrollRef = useRef<HTMLDivElement | null>(null)
  const visualizerCanvasRef = useRef<HTMLDivElement | null>(null)
  const inputChannelRef = useRef<{ control: Int32Array; payload: Uint8Array } | null>(null)
  const selectedFile = project.files[activeFile] ?? project.files[project.mainFile]
  const selectedPath = project.files[activeFile] ? activeFile : project.mainFile
  // A Markdown file as a page or as its text (see renderMarkdown), per file:
  // a read-only one starts as the page, an editable one as its text.
  const [markdownViews, setMarkdownViews] = useState<Record<string, 'page' | 'text'>>({})
  const isMarkdown = renderMarkdown !== undefined && /\.md$/i.test(selectedPath)
  const markdownView = isMarkdown ? markdownViews[selectedPath] ?? (selectedFile.readOnly ? 'page' : 'text') : 'text'
  const markdownHtml = useMemo(() => isMarkdown && markdownView === 'page' ? renderMarkdown(selectedFile.code) : '', [isMarkdown, markdownView, renderMarkdown, selectedFile.code])
  // The lines the last Tests run left uncovered (see TestCoverageView),
  // marked in the editor while that file shows, until it is edited or the
  // program runs again.
  const [coverageMarks, setCoverageMarks] = useState<{ path: string; gaps: CoverageGap[] } | null>(null)
  const testedFileRef = useRef(project.mainFile)
  const [normalEditor, setNormalEditor] = useState<Parameters<OnMount>[0] | null>(null)
  useEffect(() => {
    // The editor is unmounted (and its model gone) while visualizing.
    if (!normalEditor || !monaco || !normalEditor.getModel()) return
    const gaps = coverageMarks?.path === selectedPath ? coverageMarks.gaps : []
    const collection = normalEditor.createDecorationsCollection(gaps.map((gap) => ({ range: new monaco.Range(gap.start, 1, gap.end, 1), options: { isWholeLine: true, className: 'coverage-line', linesDecorationsClassName: 'coverage-gutter' } })))
    return () => collection.clear()
  }, [normalEditor, monaco, coverageMarks, selectedPath])
  const stringsRef = useRef(t)
  stringsRef.current = t

  useEffect(() => {
    localStorage.setItem(animationsStorageKey, String(animationsEnabled))
  }, [animationsEnabled])

  // Starts Python in a new worker, at mount and after a stop.
  const startWorker = () => {
    const worker = new Worker(new URL('./pyodide-worker.js', import.meta.url))
    worker.onmessage = (event: MessageEvent<TestReport & { type: string; output?: string; text?: string; graphics?: TurtleCommand[]; prompt?: string; id?: number; value?: string; tree?: ValueTree; untraced?: boolean; hint?: 'definition' | null; unparsed?: boolean; note?: ReplReplayNote; rootPath?: string; sources?: Record<string, string> } & Partial<TraceResult>>) => {
      const currentTranslation = stringsRef.current
      // After a stop the console keeps its transcript.
      if (event.data.type === 'ready') { if (!keepConsoleOnReadyRef.current) setOutput(currentTranslation.readyOutput); keepConsoleOnReadyRef.current = false; setRuntimeState('ready') }
      // What a program or a REPL input (by its id) prints while it runs,
      // shown in batches (see flushStreamedOutput).
      if (event.data.type === 'output') {
        streamedOutputRef.current.push({ id: event.data.id, text: event.data.text ?? '' })
        if (streamFlushTimerRef.current === null) streamFlushTimerRef.current = window.setTimeout(flushStreamedOutput, 40)
      }
      // A final result brings the whole output; what is still waiting to be
      // shown from the stream would come twice.
      if (event.data.type === 'result' || event.data.type === 'error') streamedOutputRef.current = streamedOutputRef.current.filter((chunk) => chunk.id !== undefined)
      if (event.data.type === 'repl-result') streamedOutputRef.current = streamedOutputRef.current.filter((chunk) => chunk.id !== event.data.id)
      if (event.data.type === 'error') setRuntimeState((state) => state === 'loading' ? 'failed' : state)
      if (event.data.type === 'result' || event.data.type === 'error') { setOutput(event.data.output || currentTranslation.noOutput); setOutputErrorHint(event.data.type === 'error' ? event.data.errorHint ?? null : null); setGraphics(event.data.graphics ?? []); setGraphicsDismissed(false); setIsRunning(false) }
      // What was printed before shows first; the console follows to the
      // input line.
      if (event.data.type === 'input_request') {
        if (streamFlushTimerRef.current !== null) window.clearTimeout(streamFlushTimerRef.current)
        flushStreamedOutput()
        consoleAtBottomRef.current = true
        setInputValue(''); setInputRequest(event.data.prompt ?? '')
      }
      if (['result', 'error', 'repl-result', 'trace-result', 'test-result'].includes(event.data.type)) setAnsweredInputLines([])
      if (event.data.type === 'test-result' && event.data.skipped) setIsTesting(false)
      else if (event.data.type === 'test-result') {
        const id = ++replIdRef.current
        revealEntryRef.current = id
        setConsoleEntries((entries) => [...entries, { kind: 'tests', id, report: event.data as TestReport }])
        const { uncovered, attempted = 0, failed = 0 } = event.data
        setCoverageMarks(uncovered && uncovered.length > 0 && failed === 0 && attempted > 0 ? { path: testedFileRef.current, gaps: uncovered } : null)
        setIsTesting(false)
      }
      if (event.data.type === 'repl-result') {
        const { id = -1, output = '', value, tree, untraced, error, errorHint, hint, unparsed, graphics } = event.data
        const result = { output, value, tree, untraced, error: error ?? undefined, errorHint, hint, unparsed }
        // A visualized doctest example that doesn't parse comes back here
        // too, and has no transcript entry yet.
        setConsoleEntries((entries) => entries.some((entry) => entry.kind === 'repl' && entry.id === id)
          ? entries.map((entry) => entry.kind === 'repl' && entry.id === id ? { ...entry, result, live: undefined } : entry)
          : [...entries, { kind: 'repl', id, source: replSourcesRef.current.get(id) ?? '', result }])
        replSourcesRef.current.delete(id)
        if (graphics) setGraphics(graphics)
        setIsReplBusy(false)
        setIsVisualizerLoading(false)
      }
      if (event.data.type === 'repl-replay-note') {
        const { id = -1, note } = event.data
        setConsoleEntries((entries) => entries.map((entry) => entry.kind === 'repl' && entry.id === id ? { ...entry, note } : entry))
        setIsVisualizerLoading(false)
      }
      if (event.data.type === 'trace-result') {
        setIsVisualizerLoading(false)
        setVisualRootPath(event.data.rootPath ?? null)
        if (event.data.sources) setVisualSources(event.data.sources)
        setVisualTrace(event.data as TraceResult)
        setVisualStepIndex(-1)
        setGraphicsDismissed(false)
      }
    }
    if (typeof SharedArrayBuffer !== 'undefined') {
      const buffer = new SharedArrayBuffer(8 + 4096)
      const control = new Int32Array(buffer, 0, 2)
      const payload = new Uint8Array(buffer, 8)
      inputChannelRef.current = { control, payload }
      worker.postMessage({ type: 'init-input-channel', buffer })
    }
    workerRef.current = worker
    return worker
  }
  useEffect(() => {
    const worker = startWorker()
    return () => worker.terminate()
    // Once: a stop starts the next worker itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (inputRequest !== null) inputFieldRef.current?.focus()
  }, [inputRequest])

  // Sends the line (or, cancelled, EOFError) to the waiting program. Until its
  // output brings it, the prompt and the line show as answered.
  const respondToInput = (cancelled: boolean) => {
    const channel = inputChannelRef.current
    if (inputRequest !== null) setAnsweredInputLines((lines) => [...lines, inputRequest + (cancelled ? '' : inputValue)])
    if (channel) {
      const encoded = cancelled ? new Uint8Array(0) : new TextEncoder().encode(inputValue).slice(0, channel.payload.length)
      channel.payload.fill(0)
      channel.payload.set(encoded)
      Atomics.store(channel.control, 1, encoded.length)
      Atomics.store(channel.control, 0, cancelled ? 3 : 2)
      Atomics.notify(channel.control, 0)
    }
    setInputRequest(null)
    setInputValue('')
  }

  // Only the learner's own edits. A "flush" is Monaco's setValue, which
  // @monaco-editor/react uses to show a read-only file - possibly before its
  // onChange knows the new tab, so the text would land in the previous file.
  const updateCode = (code: string | undefined, event?: { isFlush: boolean }) => {
    if (event?.isFlush) return
    if (coverageMarks?.path === activeFile) setCoverageMarks(null)
    onFileCodeChange(activeFile, code ?? '')
  }
  // While input() waits, the worker is blocked: nothing else starts until
  // the line is sent or the wait stopped.
  const runCode = () => {
    if (!workerRef.current || inputRequest !== null) return
    if (workspaceCapabilities.graphics && projectImportsGturtle(project)) onGraphicsOpenChange(true)
    runStreamStartedRef.current = false
    consoleAtBottomRef.current = true
    setIsRunning(true); setOutput(t.runningOutput(project.mainFile)); setOutputErrorHint(null); setConsoleEntries([]); setCoverageMarks(null)
    workerRef.current.postMessage({
      type: 'run',
      project: {
        mainFile: project.mainFile,
        files: Object.fromEntries(Object.entries(project.files).map(([path, file]) => [path, file.code])),
      },
    })
  }
  const runVisualize = () => {
    if (!workerRef.current || inputRequest !== null) return
    if (workspaceCapabilities.graphics && projectImportsGturtle(project)) onGraphicsOpenChange(true)
    setExampleExpectation(null)
    setIsVisualizerLoading(true)
    const sources = Object.fromEntries(Object.entries(project.files).map(([path, file]) => [path, file.code]))
    setVisualSources(sources)
    workerRef.current.postMessage({
      type: 'run-visual',
      project: { mainFile: project.mainFile, files: sources },
    })
  }
  // Tests start as Run does: an empty console and a fresh session from the
  // current files - so the REPL afterwards has exactly the definitions just
  // tested - then the doctests' report (see the worker's "test").
  const runTests = () => {
    if (!workerRef.current || isTesting || inputRequest !== null) return
    if (workspaceCapabilities.graphics && projectImportsGturtle(project)) onGraphicsOpenChange(true)
    runStreamStartedRef.current = false
    consoleAtBottomRef.current = true
    setIsTesting(true); setOutput(t.runningOutput(project.mainFile)); setOutputErrorHint(null); setConsoleEntries([]); setCoverageMarks(null)
    testedFileRef.current = project.mainFile
    workerRef.current.postMessage({
      type: 'test',
      coverage: workspaceCapabilities.coverage,
      project: {
        mainFile: project.mainFile,
        files: Object.fromEntries(Object.entries(project.files).map(([path, file]) => [path, file.code])),
      },
    })
  }
  // Visualizes a failing doctest example against the Tests run's definitions.
  const visualizeExample = (failure: { source: string; want?: string; got?: string }) => {
    if (!workerRef.current || isVisualizerLoading || inputRequest !== null) return
    const { source } = failure
    setExampleExpectation(failure.got !== undefined && failure.want !== undefined ? { got: failure.got, want: failure.want } : null)
    setIsVisualizerLoading(true)
    workerRef.current.postMessage({ type: 'run-visual-repl', id: ++replIdRef.current, source, namespace: 'test' })
  }
  // Stops whatever Python is running by ending its worker and starting a new
  // one - the only way to end e.g. "while True:" without input()'s shared
  // memory. The code stays, the console keeps what was printed and says that
  // Python restarted; earlier REPL inputs can't be visualized anymore, as
  // their session is gone.
  const restartPython = () => {
    workerRef.current?.terminate()
    // What was printed until now stays in the console.
    if (streamFlushTimerRef.current !== null) window.clearTimeout(streamFlushTimerRef.current)
    flushStreamedOutput()
    keepConsoleOnReadyRef.current = true
    setIsRunning(false); setIsReplBusy(false); setIsTesting(false); setIsVisualizerLoading(false)
    setInputRequest(null); setInputValue('')
    setRuntimeState('loading')
    startWorker()
  }
  // Stop while input() waits ends the wait as Ctrl+D does in Python: the
  // program gets EOFError and goes on (or ends with its traceback).
  const stopPython = () => {
    if (inputRequest !== null) {
      respondToInput(true)
      return
    }
    restartPython()
    setOutput((current) => current === t.runningOutput(project.mainFile) ? '' : current)
    setConsoleEntries((entries) => [
      ...entries.map((entry) => entry.kind === 'repl' ? { ...entry, stale: true, result: entry.result ?? { output: entry.live ?? '' }, live: undefined } : entry),
      { kind: 'note' as const, id: (revealEntryRef.current = ++replIdRef.current), text: t.stoppedNote ?? 'Stopped. Python was restarted.' },
    ])
  }
  // Reset: Python restarts too, and the console, the visualization and the
  // drawing start empty - as the embed's Reset, which remounts it.
  const resetPython = () => {
    restartPython()
    exitVisualizer()
    runStreamStartedRef.current = false
    setOutput(t.readyOutput); setOutputErrorHint(null); setConsoleEntries([]); setGraphics([]); setCoverageMarks(null)
  }
  const exitVisualizer = () => {
    setExampleExpectation(null)
    setFullValueView(null)
    setVisualTrace(null)
    setVisualStepIndex(-1)
    setVisualRootPath(null)
  }
  const rememberReplInput = (source: string) => {
    setReplHistory((history) => history[history.length - 1] === source ? history : [...history, source])
    setReplHistoryIndex(null)
    setReplInput('')
    const id = ++replIdRef.current
    replSourcesRef.current.set(id, source)
    return id
  }
  const submitRepl = () => {
    const source = replInput
    if (!workerRef.current || !source.trim() || isRunning || isReplBusy) return
    if (visualTrace) exitVisualizer()
    const id = rememberReplInput(source)
    revealEntryRef.current = id
    setConsoleEntries((entries) => [...entries, { kind: 'repl', id, source, result: null }])
    setIsReplBusy(true)
    workerRef.current.postMessage({ type: 'repl', id, source })
  }
  // Visualizes an entry of the history. The worker replays the session up
  // to it (see replayReplEntry): the visualization starts in the state the
  // entry ran in, or the entry gets a note why it can't.
  const visualizeReplEntry = (id: number) => {
    if (!workerRef.current || isRunning || isReplBusy || isVisualizerLoading || inputRequest !== null) return
    setConsoleEntries((entries) => entries.map((entry) => entry.kind === 'repl' && entry.id === id && entry.note ? { ...entry, note: undefined } : entry))
    setExampleExpectation(null)
    setIsVisualizerLoading(true)
    workerRef.current.postMessage({ type: 'visualize-repl-entry', id })
  }
  const handleReplKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // The program's input line: Ctrl+D ends the input (EOFError), as in a terminal.
    if (inputRequest !== null) {
      if (event.key === 'd' && event.ctrlKey && !inputValue) {
        event.preventDefault()
        respondToInput(true)
      }
      return
    }
    if (event.key === 'ArrowUp' && replHistory.length > 0) {
      event.preventDefault()
      const index = replHistoryIndex === null ? replHistory.length - 1 : Math.max(0, replHistoryIndex - 1)
      setReplHistoryIndex(index)
      setReplInput(replHistory[index])
    } else if (event.key === 'ArrowDown' && replHistoryIndex !== null) {
      event.preventDefault()
      const index = replHistoryIndex + 1
      setReplHistoryIndex(index < replHistory.length ? index : null)
      setReplInput(index < replHistory.length ? replHistory[index] : '')
    }
  }
  // The console follows new output, unless the learner scrolled up to read
  // something earlier - except for an entry a click asked for: it scrolls to
  // that entry's start, so e.g. a second Tests report doesn't land out of
  // view below the first one (P20). Only the console scrolls: scrollIntoView
  // would move the course page around the embed too.
  useEffect(() => {
    const element = outputRef.current
    if (!element) return
    const entry = revealEntryRef.current === null ? null : element.querySelector(`[data-console-entry="${revealEntryRef.current}"]`)
    if (entry) {
      revealEntryRef.current = null
      element.scrollTop += entry.getBoundingClientRect().top - element.getBoundingClientRect().top - 8
      consoleAtBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
    } else if (consoleAtBottomRef.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [consoleEntries, output])
  useEffect(() => {
    if (!command) return
    // A host's run ends a visualization, so the program's own output shows
    // instead of the visualized run's.
    if (command.type === 'run') {
      exitVisualizer()
      runCode()
    }
    if (command.type === 'visualize') runVisualize()
    if (command.type === 'test') {
      exitVisualizer()
      runTests()
    }
    if (command.type === 'stop') stopPython()
    // Restarts Python and clears the console, as the Reset button does (the
    // IDE's «Python neu starten» in its menu).
    if (command.type === 'reset') resetPython()
    // Commands are immutable events. Their id, rather than render-time callback
    // identities, determines whether the effect should run again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.id])
  const isVisualizing = visualTrace !== null
  const isBusy = isRunning || isReplBusy || isTesting || isVisualizerLoading
  const [graphicsDismissed, setGraphicsDismissed] = useState(false)
  const [consoleShare, setConsoleShare] = useState(storedConsoleShare)
  const stackRef = useRef<HTMLDivElement | null>(null)
  const changeConsoleShare = (share: number) => {
    const clamped = Math.min(CONSOLE_SHARE_MAX, Math.max(CONSOLE_SHARE_MIN, share))
    setConsoleShare(clamped)
    try { localStorage.setItem(consoleShareStorageKey, String(clamped)) } catch { /* not remembered */ }
  }
  // The divider follows the pointer (mouse, pen or finger) ...
  const startConsoleResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stack = stackRef.current
    if (!stack) return
    event.preventDefault()
    const divider = event.currentTarget
    divider.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => {
      const rect = stack.getBoundingClientRect()
      changeConsoleShare((rect.bottom - moveEvent.clientY) / rect.height)
    }
    const end = () => {
      divider.removeEventListener('pointermove', move)
      divider.removeEventListener('pointerup', end)
      divider.removeEventListener('pointercancel', end)
    }
    divider.addEventListener('pointermove', move)
    divider.addEventListener('pointerup', end)
    divider.addEventListener('pointercancel', end)
  }
  // ... and the arrow keys: up makes the console taller.
  const resizeConsoleWithKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowUp: 0.05, ArrowDown: -0.05, PageUp: 0.15, PageDown: -0.15 }
    if (event.key in steps) changeConsoleShare(consoleShare + steps[event.key])
    else if (event.key === 'Home') changeConsoleShare(CONSOLE_SHARE_MIN)
    else if (event.key === 'End') changeConsoleShare(CONSOLE_SHARE_MAX)
    else return
    event.preventDefault()
  }
  const [showStopButton, setShowStopButton] = useState(false)
  useEffect(() => {
    if (!isBusy) { setShowStopButton(false); return }
    const timer = window.setTimeout(() => setShowStopButton(true), STOP_BUTTON_DELAY)
    return () => window.clearTimeout(timer)
  }, [isBusy])
  const onBusyChangeRef = useRef(onBusyChange)
  onBusyChangeRef.current = onBusyChange
  useEffect(() => { onBusyChangeRef.current?.(showStopButton) }, [showStopButton])
  // Without emptyOutput, a visualization of a program that prints nothing
  // and raises no error has no output panel - decided for the whole trace,
  // so the panel doesn't appear mid-way at the first print. The REPL's input
  // line lives in the panel, so it stays wherever there is one.
  const hideOutputPanel = !workspaceCapabilities.emptyOutput && !workspaceCapabilities.repl
    && visualTrace !== null && !visualTrace.output && !visualTrace.error
  // input() asks in the console's input line, where the REPL's is; only
  // without a console (see hideOutputPanel) in a dialog.
  const programInput = inputRequest !== null && !hideOutputPanel
  // The steps the scrubber and the step buttons move through: every step of
  // the trace in the box mode, only the visible substitutions in the
  // substitution mode (see substitutionModeSteps). Rendering always replays
  // the whole trace up to the current step's own step number.
  const astIndexByFile = useMemo(() => {
    const map = new Map<string, ReturnType<typeof indexAstNodes>>()
    if (visualTrace) for (const [path, file] of Object.entries(visualTrace.ast)) map.set(path, indexAstNodes(file))
    return map
  }, [visualTrace])

  // In the tree mode, the substitution mode's steps plus those that open and
  // close each expression's tree (see treeModeSteps).
  const treeSteps = useMemo(
    () => visualTrace && treeMode ? treeModeSteps(visualTrace.trace, substitutionModeSteps(visualTrace.trace), astIndexByFile) : null,
    [visualTrace, treeMode, astIndexByFile],
  )
  const visualTraceSteps = useMemo(
    () => !visualTrace ? [] : treeSteps ? treeSteps.steps : substitutionMode ? substitutionModeSteps(visualTrace.trace) : visualTrace.trace,
    [visualTrace, substitutionMode, treeSteps],
  )
  // The frames open after a trace step, for laying out the trees shown
  // before the current one (see episodeTreeLayout).
  const treeFramesAt = useMemo(() => {
    const cache = new Map<number, Map<number, OpenFrame>>()
    return (step: number) => {
      let frames = cache.get(step)
      if (!frames) cache.set(step, frames = computeOpenFramesUpTo(visualTrace?.trace ?? [], step))
      return frames
    }
  }, [visualTrace])
  // Lower bound of -1 is the "before execution" state; upper bound is the
  // last recorded step (or -1 itself if no steps were recorded at all).
  const clampedStepIndex = Math.min(Math.max(visualStepIndex, -1), Math.max(0, visualTraceSteps.length - 1))
  const currentTraceStep = visualTraceSteps[clampedStepIndex] ?? null
  const fullValueAccess = useMemo<FullValueAccess>(() => ({
    values: fullValuesUpTo(visualTrace?.trace ?? [], currentTraceStep?.step ?? -1, visualTrace?.values),
    trees: workspaceCapabilities.listTree ? valueTreesUpTo(visualTrace?.trace ?? [], currentTraceStep?.step ?? -1, visualTrace?.trees) : new Map(),
    showTrees: workspaceCapabilities.listTree && showListTrees,
    open: (value, name, tree) => setFullValueView({ value, name, tree: workspaceCapabilities.listTree && showListTrees ? tree : undefined }),
    t,
  }), [visualTrace, currentTraceStep, t, workspaceCapabilities.listTree, showListTrees])
  // The step that will run next if the learner clicks "next" - previewed
  // via highlighting its AST span, including before any step has run yet
  // (clampedStepIndex === -1), so the very first statement is shown too.
  const nextTraceStep = visualTraceSteps[clampedStepIndex + 1] ?? null
  // A run that failed ends in one 'error' step (see TraceStepKind). The
  // visualizer still starts before the first step, so learners step towards
  // the failure; the scrubber marks where it is.
  const lastTraceStep = visualTraceSteps[visualTraceSteps.length - 1]
  const errorTraceStep = lastTraceStep?.kind === 'error' ? lastTraceStep : null
  const isAtErrorStep = errorTraceStep !== null && currentTraceStep === errorTraceStep
  const visualStdout = visualTrace?.output.slice(0, currentTraceStep?.stdoutLen ?? 0) ?? ''
  // What the console shows at the last step: in a host whose height follows
  // the content, the console keeps that height from the start (invisibly,
  // see .visual-output-steady), so it doesn't grow with every print.
  const visualFinalOutput = visualTrace ? `${visualTrace.output}${visualTrace.error && errorTraceStep ? `${visualTrace.output && !visualTrace.output.endsWith('\n') ? '\n' : ''}${visualTrace.error}` : ''}` || t.noOutput : ''

  // When the pending next step is a bare variable read (e.g. "n" about to
  // be looked up and substituted by its current value), note which frame
  // and name it reads from - so an arrow can be drawn from that variable's
  // row in the locals panel to the highlighted "n" in the code, making the
  // upcoming substitution concrete instead of implicit.
  const nextStepVarSource = useMemo(() => {
    if (!nextTraceStep) return null
    const node = astIndexByFile.get(nextTraceStep.path)?.get(nextTraceStep.nodeId)
    if (!node || node.type !== 'Name') return null
    const frameId = nextTraceStep.kind === 'call-enter' ? (nextTraceStep.parentFrameId ?? 0) : nextTraceStep.frameId
    return { frameId, varName: node.summary }
  }, [nextTraceStep, astIndexByFile])

  // When the pending next step is a plain "x = ..." assignment or a
  // "def f(...):" that's about to bind a name this frame doesn't have yet,
  // note which frame and name it's about to create - so that name can be
  // shown one step early as a valueless placeholder row (see Frame's
  // `declareTarget` prop), with an arrow drawn from the upcoming
  // value/def in the code into that placeholder instead of the other way
  // around.
  const nextStepDeclareTarget = useMemo(
    () => declareTargetFor(visualTraceSteps, currentTraceStep, nextTraceStep, astIndexByFile),
    [nextTraceStep, astIndexByFile, visualTraceSteps, currentTraceStep],
  )

  // When the pending next step is a "call-enter" (a user-defined function
  // about to start running), synthesize that callee frame's OpenFrame
  // entry one step early so it renders inline at its call site exactly
  // like any other open frame (see `framesForRender` below, merged into
  // the `openFrames` map handed down to <Frame>) - since no trace steps
  // exist yet for that frame id, every locals/substitution lookup keyed
  // off it naturally comes back empty, so it renders "for free" as a
  // totally fresh, not-yet-started call - except its header already shows
  // each bound parameter's real value one step early via paramAnnotations
  // (exactly like a real open frame does, see the Frame component's
  // `annotations` map), which is also where the connector arrows below
  // originate from. Also keeps the raw argSources list around (now just
  // each bound parameter's name, in parameter-def order), used to seed
  // this frame's own parameters as valueless placeholder rows
  // (`pendingCallLocals`).
  const nextStepPendingCall = useMemo(() => pendingCallFor(nextTraceStep, substitutionMode), [nextTraceStep, substitutionMode])

  // When the pending next step is a "call-pending" (a user-defined call
  // whose callee and arguments are already resolved - the call site reads
  // e.g. "fact(2)" - but whose frame hasn't opened yet, see
  // "call-pending"/`lookupName` on TraceStep), note which frame and name
  // the callee itself is bound under - so an arrow can be drawn from that
  // name's own row in the locals panel (showing "function", see
  // `_glpython_describe_for_locals_panel`) into the highlighted call
  // expression, representing the upcoming function lookup. Deliberately
  // distinct from `nextStepPendingCall` above: that one still only fires
  // for the step *after* this one (its own `call-enter` step), so the
  // callee's frame box correctly stays closed for the one extra step this
  // adds.
  const nextStepFuncLookup = useMemo(() => {
    if (!nextTraceStep || nextTraceStep.kind !== 'call-pending' || nextTraceStep.lookupName === null || nextTraceStep.lookupFrameId === null) return null
    return { frameId: nextTraceStep.lookupFrameId, varName: nextTraceStep.lookupName }
  }, [nextTraceStep])

  // SVG paths (in the coordinate space of .visualizer-canvas) for the
  // arrows above, measured straight from the rendered DOM once per
  // relevant change - there's no other reliable way to know where either
  // endpoint ends up on screen, since both sit inside reflowing,
  // variable-width text. Usually at most one path is active at once, but a
  // function call with several arguments needs one simultaneous arrow per
  // argument, hence an array rather than a single optional path. Each
  // entry also carries the text of its "known" endpoint (where the arrow
  // starts), so that if this very arrow disappears on the next step - i.e.
  // its value just got substituted - a short-lived copy of that text can
  // fly along the same curve into its destination (see `flights` below).
  // `kind` lets the layout effect treat a connector differently depending
  // on what it represents: 'funcLookup' connectors never fly their value as
  // a flight (the about-to-open frame-box flies/grows from that spot
  // instead - see the box-origin logic below), and 'arg' connectors (the
  // per-parameter arrows into a freshly-opened callee frame) aren't even
  // measured until that frame-box's own move+grow animation has finished
  // (see `growListenerRef` below) - measuring any earlier would read back
  // the box's still-shrunken, mid-flight geometry. `x1`/`y1` are the
  // connector's source anchor point (canvas-relative), kept around so the
  // box-origin logic can reuse it without re-measuring the DOM. A return
  // value collapsing into its call site is handled separately, below (see
  // `pendingReturnOriginRef`) - it never draws an arrow at all, instead
  // flying the real destination span in directly, so it has no 'return'
  // entry in this union.
  type Connector = { d: string; value: string; kind: 'var' | 'funcLookup' | 'arg'; x1: number; y1: number }
  const [connectorPaths, setConnectorPaths] = useState<Connector[]>([])

  // Short-lived "value flying along the arrow it just consumed" ghosts,
  // spawned in the layout effect below whenever stepping forward makes a
  // previously-shown connector disappear. Purely decorative (and disabled
  // along with every other animation via `animationsEnabled`), so each one
  // just removes itself again once its CSS motion-path animation ends.
  const [flights, setFlights] = useState<{ id: number; d: string; value: string }[]>([])
  const flightIdRef = useRef(0)
  const prevConnectorsRef = useRef<Connector[]>([])
  // The about-to-close callee frame's own return-line position, measured
  // while the box is still open and stashed here so the *next* effect run -
  // once the frame has actually closed and the parent's substituted-value
  // span for this call has been freshly mounted in its place - can compute
  // how far that real span needs to fly in from (see the 'return value
  // flight' block in the effect below). Unlike `prevConnectorsRef`, this
  // never backs a visible arrow; it's pure bookkeeping for one single
  // pending transition at a time (a frame can only close once).
  const pendingReturnOriginRef = useRef<{ nodeId: number; parentFrameId: number; x: number; y: number } | null>(null)
  // A frozen visual snapshot (geometry + markup) of the about-to-close
  // callee frame-box, taken in the same moment as `pendingReturnOriginRef`
  // above, while the real box still exists in the DOM. React removes the
  // real box the instant the frame actually closes (it's simply no longer
  // in `openFrames`), so there's nothing left to fade out by then - this
  // snapshot is what lets a short-lived ghost copy of it fade out in place
  // afterwards, in parallel with the real return value flying into its
  // destination (see `closingBoxes` below).
  const pendingClosingBoxRef = useRef<{ left: number; top: number; width: number; height: number; html: string } | null>(null)
  // Short-lived ghost copies of just-closed frame-boxes, rendered as plain
  // (non-interactive) markup absolutely positioned over where the real box
  // used to sit, fading out via CSS while the real return value flies into
  // its destination elsewhere. Spawned/removed the same way as `flights`
  // above.
  const [closingBoxes, setClosingBoxes] = useState<{ id: number; left: number; top: number; width: number; height: number; html: string }[]>([])
  const closingBoxIdRef = useRef(0)
  // Tracks the one 'animationend' listener (if any) currently waiting on a
  // freshly-opened callee frame-box's grow animation, so a later effect run
  // (e.g. the user stepping again before it fires) can detach it instead of
  // leaving it to fire against a now-stale step.
  const growListenerRef = useRef<{ el: HTMLElement; handler: (event: AnimationEvent) => void } | null>(null)
  const prevStepIndexRef = useRef(clampedStepIndex)
  const animationsEnabledRef = useRef(animationsEnabled)
  animationsEnabledRef.current = animationsEnabled


  // Keep the open tab in sync with whichever file the trace is currently
  // executing in at module scope (e.g. an import's own top-level code) -
  // but never for code running inside a call frame, since that now renders
  // inline at its own call site instead of jumping the view away to
  // wherever it's defined.
  useEffect(() => {
    if (!currentTraceStep || currentTraceStep.frameId !== 0) return
    if (!project.files[currentTraceStep.path]) return
    onOpenFile(currentTraceStep.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTraceStep?.path, currentTraceStep?.frameId])

  // Every call frame still open at the current step (module scope, frame 0,
  // is implicit and not included here) - drives both the Frame rendering
  // below and which frame's steps "count" for locals/highlighting above.
  const openFrames = useMemo(
    () => visualTrace ? computeOpenFramesUpTo(visualTrace.trace, currentTraceStep?.step ?? -1) : new Map<number, OpenFrame>(),
    [visualTrace, currentTraceStep],
  )

  // When the pending next step closes a callee frame (its own "eval" step
  // for the Call node, once the callee has fully returned - see
  // `closesFrameId` on TraceStep), note which frame is about to collapse,
  // the call node whose substituted-value span will appear in its place
  // once the frame is gone, and which parent frame that span renders
  // inside - so the layout effect below can, once the frame actually
  // closes, find that exact newly-mounted span (via its
  // `data-annotation-node-id`, scoped to the parent frame-box so same-nodeId
  // spans from other simultaneously-open recursive calls aren't matched by
  // mistake) and have it fly in from the collapsing box's old position,
  // rather than drawing a connecting arrow.
  const nextStepReturnFlight = useMemo(() => {
    if (!nextTraceStep || nextTraceStep.closesFrameId === null || nextTraceStep.valueText === null) return null
    const parentFrameId = openFrames.get(nextTraceStep.closesFrameId)?.parentFrameId ?? 0
    return { frameId: nextTraceStep.closesFrameId, nodeId: nextTraceStep.nodeId, parentFrameId }
  }, [nextTraceStep, openFrames])

  // `openFrames` plus, when applicable, the one synthetic "about to open"
  // callee frame from `nextStepPendingCall` above - this is what actually
  // gets handed down to <Frame>, so that pending frame renders inline at
  // its call site one step early, exactly like any other already-open call.
  const framesForRender = useMemo(() => framesWithPendingCall(openFrames, nextStepPendingCall), [openFrames, nextStepPendingCall])

  const pendingCallLocals = useMemo(() => nextStepPendingCall
    ? { frameId: nextStepPendingCall.openFrame.frameId, paramNames: nextStepPendingCall.argSources }
    : null, [nextStepPendingCall])

  const collapsedCalls = useMemo(
    () => collapsedCallsOf(framesForRender, nextStepPendingCall, substitutionMode),
    [framesForRender, nextStepPendingCall, substitutionMode],
  )

  const inlineHostOf = (frameId: number | undefined) => inlineHostIn(framesForRender, astIndexByFile, substitutionMode, frameId)
  // The visualizer's root file: a visualized REPL input's pseudo-file, or the
  // main file.
  const chainRootPath = visualRootPath ?? project.mainFile
  const canCopyChain = visualTrace !== null && currentTraceStep !== null
    && hasEvaluationChain(visualTrace.trace, visualTrace.ast, astIndexByFile.get(chainRootPath), chainRootPath, currentTraceStep)
  const copyEvaluationChain = async () => {
    if (!visualTrace || !currentTraceStep) return
    const chain = buildEvaluationChain({
      trace: visualTrace.trace,
      ast: visualTrace.ast,
      nodeIndexByFile: astIndexByFile,
      sources: visualSources,
      rootPath: chainRootPath,
      step: currentTraceStep,
      errorMessage: visualTrace.errorMessage ?? null,
      comments: chainComments,
      strings: {
        conditionComment: t.chainConditionComment ?? ((condition, value) => `${condition} is ${value}`),
        localsComment: t.chainLocalsComment ?? 'body with local variables',
      },
    })
    if (chain === null) return
    setChainFeedback(await copyText(chain) ? 'copied' : 'failed')
  }
  const changeChainComments = (enabled: boolean) => {
    setChainComments(enabled)
    try { localStorage.setItem(chainCommentsStorageKey, String(enabled)) } catch { /* the choice just isn't remembered */ }
  }
  useEffect(() => {
    if (chainFeedback === null) return
    const timer = window.setTimeout(() => setChainFeedback(null), 2000)
    return () => window.clearTimeout(timer)
  }, [chainFeedback])
  // At the last step of a visualized failing doctest example: what doctest
  // got and what the example expected, as the texts doctest compared.
  const isAtLastStep = visualTraceSteps.length > 0 && clampedStepIndex === visualTraceSteps.length - 1
  const finalNoteAt = (view: StepView) => view.isAtLastStep && exampleExpectation && view.currentStep
    ? {
        line: view.currentStep.frameId === 0 ? view.currentStep.endLine : 1,
        text: (t.exampleGotExpected ?? ((got: string, want: string) => `Got: ${got} \u00b7 Expected: ${want}`))(
          exampleExpectation.got.replace(/\n$/, '') || t.noOutput,
          exampleExpectation.want.replace(/\n$/, ''),
        ),
      }
    : null
  const activeHost = inlineHostOf(currentTraceStep?.frameId)
  const errorHost = isAtErrorStep ? inlineHostOf(errorTraceStep.frameId) : null
  const currentActiveTrees = useMemo(() => treeSteps ? activeTreesAt(treeSteps.episodes, clampedStepIndex) : new Map<number, TreeEpisode>(), [treeSteps, clampedStepIndex])
  const currentStepView: StepView = { currentStep: currentTraceStep, nextStep: nextTraceStep, openFrames, pendingCall: nextStepPendingCall, framesForRender, pendingCallLocals, collapsedCalls, declareTarget: nextStepDeclareTarget, isAtErrorStep, isAtLastStep, activeHost, errorHost, activeTrees: currentActiveTrees }
  // Why a call stays a box in the substitution and tree modes, at its box.
  const boxHintFor = (reason: BoxReason | null, funcName: string): ReactNode => {
    const text = reason ? t.visualizerBoxReason?.(reason) : undefined
    if (!text) return t.visualizerBoxHint ?? 'The box shows which return is executed.'
    return <><code>{funcName}</code> {text}</>
  }
  // The module's frame at a step, with the boxes and inline calls inside it.
  const rootFrame = (view: StepView) => {
    const collapsedLabel = view.collapsedCalls
      ? t.visualizerCollapsedCalls?.(view.collapsedCalls.hiddenCount, view.collapsedCalls.callText)
        ?? `\u2026 ${view.collapsedCalls.hiddenCount} more calls${view.collapsedCalls.callText ? ` of ${view.collapsedCalls.callText}` : ''} \u2026`
      : ''
    return <Frame frameId={0} path={visualRootPath ?? activeFile} scope={{ kind: 'module' }} openFrames={view.framesForRender} nodeIndexByFile={astIndexByFile} visualSources={visualSources} trace={visualTrace?.trace ?? []} uptoStep={view.currentStep?.step ?? -1} currentStep={view.currentStep} nextStep={view.nextStep} monaco={monaco} valueKindLabels={valueKindLabels} hiddenRanges={visualTrace?.hidden ?? {}} declareTarget={view.declareTarget} pendingCallLocals={view.pendingCallLocals} errorStep={view.isAtErrorStep ? errorTraceStep : null} collapsedCalls={view.collapsedCalls} collapsedCallsLabel={collapsedLabel} substitutionMode={substitutionMode} boxHint={boxHintFor} trees={treeMode ? { active: view.activeTrees, framesAt: treeFramesAt } : null} insideBox={false} activeHost={view.activeHost} errorHost={view.errorHost} finalNote={finalNoteAt(view)} errorHint={view.isAtErrorStep && visualTrace?.errorHint && t.errorHint?.(visualTrace.errorHint, 'other') ? <ErrorHintNote hint={visualTrace.errorHint} t={t} /> : null} />
  }
  const changeVisualizerMode = (mode: VisualizerMode) => {
    if (mode === effectiveMode) return
    // Stay at the same point of the program: the last step of the new mode's
    // list that isn't past the current one.
    if (visualTrace) {
      const current = currentTraceStep?.step ?? -1
      const steps = mode === 'tree' ? treeModeSteps(visualTrace.trace, substitutionModeSteps(visualTrace.trace), astIndexByFile).steps : mode === 'substitution' ? substitutionModeSteps(visualTrace.trace) : visualTrace.trace
      let index = -1
      steps.forEach((step, stepIndex) => { if (step.step <= current) index = stepIndex })
      setVisualStepIndex(index)
    }
    setVisualizerMode(mode)
    try { localStorage.setItem(visualizerModeStorageKey, mode) } catch { /* the choice just isn't remembered */ }
  }

  useLayoutEffect(() => {
    const canvas = visualizerCanvasRef.current
    if (!canvas) { setConnectorPaths([]); return }
    const canvasRect = canvas.getBoundingClientRect()

    // One bezier path (in the given canvas-relative coordinate space)
    // between two already-rendered DOM elements, always exiting the source
    // from whichever side faces the target and entering the target from
    // whichever side faces the source - so the curve never has to double
    // back through either endpoint's own text, regardless of which visual
    // direction this particular arrow happens to flow in (locals -> code,
    // code -> locals, or code -> code). `rect` is taken as a parameter
    // (rather than closing over a single canvas rect measured once) so the
    // deferred per-argument measurement below can re-measure the canvas
    // fresh once the callee frame-box's grow animation has actually
    // finished, instead of reusing a rect captured while it was still mid-flight.
    const pathBetween = (sourceEl: Element, targetEl: Element, kind: Connector['kind'], rect: DOMRect): Connector => {
      const sourceRect = sourceEl.getBoundingClientRect()
      const targetRect = targetEl.getBoundingClientRect()
      const y1 = sourceRect.top - rect.top + sourceRect.height / 2
      const y2 = targetRect.top - rect.top + targetRect.height / 2
      const dir = targetRect.left + targetRect.right >= sourceRect.left + sourceRect.right ? 1 : -1
      const x1 = (dir === 1 ? sourceRect.right : sourceRect.left) - rect.left
      const x2 = (dir === 1 ? targetRect.left : targetRect.right) - rect.left
      const dx = Math.max(Math.abs(x2 - x1) * 0.5, 40)
      // Strip a leading "=" from parameter-annotation sources (e.g. the
      // "=3" shown next to "n" in "def fact(n=3):") so the flying copy
      // reads as a plain value, matching what lands in the locals row.
      const value = (sourceEl.textContent?.trim() ?? '').replace(/^=/, '')
      return { d: `M ${x1} ${y1} C ${x1 + dx * dir} ${y1}, ${x2 - dx * dir} ${y2}, ${x2} ${y2}`, value, kind, x1, y1 }
    }

    const paths: Connector[] = []

    // "nextStepVarSource" means a value already known in the locals panel
    // is about to flow out into the code (arrow: locals -> code);
    // "nextStepDeclareTarget" is the opposite - a value already sitting in
    // the code is about to flow into a freshly-declared, still-valueless
    // locals row (arrow: code -> locals). Only one of the two can ever be
    // set at once, since they key off disjoint AST node types.
    const varAnchor = nextStepVarSource ?? nextStepDeclareTarget
    if (varAnchor) {
      const varEl = canvas.querySelector(
        `.frame-box[data-frame-id="${varAnchor.frameId}"] > .frame-vars > .locals-row[data-name="${CSS.escape(varAnchor.varName)}"] .locals-value`,
      )
      const codeEl = canvas.querySelector('.visual-next-step')
      if (varEl && codeEl) paths.push(pathBetween(nextStepVarSource ? varEl : codeEl, nextStepVarSource ? codeEl : varEl, 'var', canvasRect))
    }

    // "nextStepFuncLookup": the about-to-be-called function's own row in
    // whichever frame defines it (showing "function") flowing into the
    // fully-substituted call expression itself (e.g. "fact(2)") - the same
    // locals -> code direction as `nextStepVarSource` above, just keyed off
    // a different step kind, so it's always disjoint from both `varAnchor`
    // cases and can safely add its own path alongside them.
    if (nextStepFuncLookup) {
      const funcEl = canvas.querySelector(
        `.frame-box[data-frame-id="${nextStepFuncLookup.frameId}"] > .frame-vars > .locals-row[data-name="${CSS.escape(nextStepFuncLookup.varName)}"] .locals-value`,
      )
      const codeEl = canvas.querySelector('.visual-next-step')
      if (funcEl && codeEl) paths.push(pathBetween(funcEl, codeEl, 'funcLookup', canvasRect))
    }

    // "nextStepReturnFlight": measure (while the callee frame-box is still
    // open) the canvas-relative point its own current (return) line sits
    // at - this is "the return site" the value is flying from. No arrow is
    // drawn for it; the point is just stashed in `pendingReturnOriginRef`
    // for the *next* effect run to pick up once the frame has actually
    // closed, at which point the parent's freshly-substituted value span
    // for this exact call (found via `nodeId`, scoped to `parentFrameId` -
    // see below) gets flown in from this very point instead. The box's own
    // full geometry + markup is snapshotted into `currentClosingBox` at the
    // same time, for a fade-out ghost of the whole box (see
    // `pendingClosingBoxRef` above).
    let currentReturnOrigin: { nodeId: number; parentFrameId: number; x: number; y: number } | null = null
    let currentClosingBox: { left: number; top: number; width: number; height: number; html: string } | null = null
    if (nextStepReturnFlight) {
      const boxEl = canvas.querySelector(`.frame-box[data-frame-id="${nextStepReturnFlight.frameId}"]`)
      const lineEl = boxEl?.querySelector('.visual-current-line')
      if (lineEl) {
        const lineRect = lineEl.getBoundingClientRect()
        currentReturnOrigin = {
          nodeId: nextStepReturnFlight.nodeId,
          parentFrameId: nextStepReturnFlight.parentFrameId,
          x: lineRect.left - canvasRect.left + lineRect.width / 2,
          y: lineRect.top - canvasRect.top + lineRect.height / 2,
        }
      }
      if (boxEl instanceof HTMLElement) {
        const boxRect = boxEl.getBoundingClientRect()
        // Clone rather than reuse the real node (which is about to be
        // unmounted anyway), and strip every attribute/class any *other*
        // query in this same effect keys off of (data-frame-id,
        // data-annotation-node-id, data-name, the unscoped `.visual-next-step`
        // lookup, ...) - this frozen, inert ghost must never be able to
        // accidentally satisfy a query meant for the live, currently-
        // rendered tree once it lingers on-screen for its fade-out. Also
        // forces off every CSS animation still named on its descendants
        // (grow-in, locals value pop, ...) - this is a static, already-
        // settled snapshot, and being freshly inserted markup would
        // otherwise replay all of those from scratch alongside its own
        // fade-out.
        const clone = boxEl.cloneNode(true) as HTMLElement
        clone.removeAttribute('data-frame-id')
        clone.style.animation = 'none'
        clone.querySelectorAll('[data-frame-id], [data-annotation-node-id], [data-name], .visual-next-step, .visual-current-line').forEach((el) => {
          el.removeAttribute('data-frame-id')
          el.removeAttribute('data-annotation-node-id')
          el.removeAttribute('data-name')
          el.classList.remove('visual-next-step', 'visual-current-line')
        })
        clone.querySelectorAll<HTMLElement>('*').forEach((el) => { el.style.animation = 'none' })
        currentClosingBox = {
          left: boxRect.left - canvasRect.left,
          top: boxRect.top - canvasRect.top,
          width: boxRect.width,
          height: boxRect.height,
          html: clone.outerHTML,
        }
      }
    }

    // One arrow per bound parameter of the about-to-open callee frame:
    // from that parameter's own annotation in the callee's own header
    // (e.g. the "3" in "def fact(n=3):", identified by its AST node id via
    // data-annotation-node-id - matched to this paramName via the callee's
    // own paramAnnotations, since argSources is just a plain name list)
    // into that parameter's placeholder row in the locals panel below it.
    // Takes `rect` as a parameter (see `pathBetween` above) rather than
    // closing over `canvasRect`, since it also gets called later, after a
    // fresh re-measurement, from the deferred grow-animation handler below.
    const buildArgConnectors = (rect: DOMRect): Connector[] => {
      if (!nextStepPendingCall) return []
      const calleeFrameId = nextStepPendingCall.openFrame.frameId
      const result: Connector[] = []
      for (const paramName of nextStepPendingCall.argSources) {
        const annotation = nextStepPendingCall.openFrame.paramAnnotations.find(([, , name]) => name === paramName)
        if (!annotation) continue
        const [nodeId] = annotation
        const argEl = canvas.querySelector(`.frame-box[data-frame-id="${calleeFrameId}"] [data-annotation-node-id="${nodeId}"]`)
        const paramEl = canvas.querySelector(
          `.frame-box[data-frame-id="${calleeFrameId}"] > .frame-vars > .locals-row[data-name="${CSS.escape(paramName)}"] .locals-value`,
        )
        if (argEl && paramEl) result.push(pathBetween(argEl, paramEl, 'arg', rect))
      }
      return result
    }

    // Detach any previously-scheduled grow-animation listener before
    // (possibly) scheduling a new one below - otherwise a listener left over
    // from an earlier step the user has since moved away from could fire
    // later and append a stale arrow for a frame that's no longer pending.
    if (growListenerRef.current) {
      growListenerRef.current.el.removeEventListener('animationend', growListenerRef.current.handler)
      growListenerRef.current.el.removeEventListener('animationcancel', growListenerRef.current.handler)
      growListenerRef.current = null
    }

    if (nextStepPendingCall) {
      const calleeFrameId = nextStepPendingCall.openFrame.frameId

      // Rather than fading/growing in place, the freshly-opened callee
      // frame-box flies in from wherever its own "function" row was sitting
      // in its defining scope a moment ago (the very spot the now-gone
      // 'funcLookup' connector pointed out of) - so stash that point as a
      // translate offset, consumed by the `visual-frame-grow` keyframe in
      // App.css, which animates it back down to (0, 0) while scaling up.
      // Frames with no such predecessor (shouldn't normally happen, but
      // kept as a safe fallback) just scale up in place instead.
      const boxEl = canvas.querySelector(`.frame-box[data-frame-id="${calleeFrameId}"]`)
      if (boxEl instanceof HTMLElement) {
        const origin = prevConnectorsRef.current.find((connector) => connector.kind === 'funcLookup')
        if (origin) {
          const boxRect = boxEl.getBoundingClientRect()
          const cx = boxRect.left - canvasRect.left + boxRect.width / 2
          const cy = boxRect.top - canvasRect.top + boxRect.height / 2
          boxEl.style.setProperty('--grow-dx', `${origin.x1 - cx}px`)
          boxEl.style.setProperty('--grow-dy', `${origin.y1 - cy}px`)
        } else {
          boxEl.style.removeProperty('--grow-dx')
          boxEl.style.removeProperty('--grow-dy')
        }

        if (animationsEnabledRef.current) {
          // This effect runs synchronously before paint, i.e. before the
          // box's own CSS grow animation has had any chance to run - so
          // every element inside it, including the per-argument targets
          // above, would currently measure at the box's shrunken, mid-flight
          // size/position rather than its real, settled one. Measuring now
          // would bake those wrong coordinates straight into the arrow, so
          // instead wait for the box's grow animation to actually finish and
          // only then measure/add the per-argument arrows. Also handles
          // 'animationcancel' (e.g. the user unchecks "animate steps" while
          // the box is still mid-grow, which abruptly removes the
          // animation instead of ever firing 'animationend') the same way,
          // since by that point the box is already at its real final size.
          const handleGrowEnd = (event: AnimationEvent) => {
            if (event.target !== boxEl || event.animationName !== 'visual-frame-grow') return
            boxEl.removeEventListener('animationend', handleGrowEnd)
            boxEl.removeEventListener('animationcancel', handleGrowEnd)
            if (growListenerRef.current?.handler === handleGrowEnd) growListenerRef.current = null
            const argConnectors = buildArgConnectors(canvas.getBoundingClientRect())
            if (argConnectors.length === 0) return
            setConnectorPaths((current) => [...current, ...argConnectors])
            prevConnectorsRef.current = [...prevConnectorsRef.current, ...argConnectors]
          }
          boxEl.addEventListener('animationend', handleGrowEnd)
          boxEl.addEventListener('animationcancel', handleGrowEnd)
          growListenerRef.current = { el: boxEl, handler: handleGrowEnd }
        } else {
          // No animation is going to play at all, so the box is already at
          // its real, final size/position right now - measure immediately.
          paths.push(...buildArgConnectors(canvasRect))
        }
      }
    }

    // Stepping forward past a step that was showing a connector turns that
    // connector's "known" endpoint into the real, now-substituted value -
    // exactly the transition the arrow was foreshadowing - so fly a copy of
    // its text along the very same curve it just traced, into whichever
    // destination it was pointing at. Stepping backward (or sideways, via
    // the scrubber) undoes rather than performs a substitution, so it never
    // spawns flights; it just drops the stale connectors like before. The
    // one exception is a 'funcLookup' connector disappearing because its
    // callee frame-box just opened - that transition is shown by the box
    // itself flying/growing in from that spot (see above) instead of a
    // flying copy of the word "function".
    const steppedForward = clampedStepIndex > prevStepIndexRef.current
    const flightSources = prevConnectorsRef.current.filter((connector) => connector.kind !== 'funcLookup')
    if (steppedForward && animationsEnabledRef.current && flightSources.length > 0) {
      const newFlights = flightSources.map((connector) => ({ id: flightIdRef.current++, ...connector }))
      setFlights((current) => [...current, ...newFlights])
      const ids = newFlights.map((f) => f.id)
      // Matches the `.visual-flight-move` / `.visual-flight-arrow-fade` animation duration in App.css.
      window.setTimeout(() => setFlights((current) => current.filter((f) => !ids.includes(f.id))), 600)
    }

    // The return-flight counterpart of the above: stepping forward past a
    // return-collapse makes the callee frame-box (whose return line we
    // measured and stashed last render) actually disappear, replaced by a
    // plain `.visual-substituted-value` span back in the parent - find that
    // exact freshly-mounted span by its nodeId (scoped to its parent
    // frame-box) and set its own `--return-dx`/`--return-dy` offset to the
    // delta from the stashed return-site point, so the `visual-return-fly-in`
    // keyframe in App.css (applied unconditionally to every substituted
    // value, default offset zero) animates this real element in from there -
    // no arrow, no separate ghost copy, just the actual value sliding into
    // place from where it was computed.
    if (steppedForward && animationsEnabledRef.current && pendingReturnOriginRef.current) {
      const origin = pendingReturnOriginRef.current
      const destEl = canvas.querySelector(
        `.frame-box[data-frame-id="${origin.parentFrameId}"] [data-annotation-node-id="${origin.nodeId}"].visual-substituted-value`,
      )
      if (destEl instanceof HTMLElement) {
        const destRect = destEl.getBoundingClientRect()
        const destX = destRect.left - canvasRect.left + destRect.width / 2
        const destY = destRect.top - canvasRect.top + destRect.height / 2
        destEl.style.setProperty('--return-dx', `${origin.x - destX}px`)
        destEl.style.setProperty('--return-dy', `${origin.y - destY}px`)
      }
    }

    // Spawns the closing-box fade-out ghost (see `pendingClosingBoxRef`
    // above) in lockstep with the return-value fly-in just above, so the
    // old box visibly dissolves in place while the real value it contained
    // slides out of it into its destination, instead of just vanishing.
    if (steppedForward && animationsEnabledRef.current && pendingClosingBoxRef.current) {
      const box = pendingClosingBoxRef.current
      const id = closingBoxIdRef.current++
      setClosingBoxes((current) => [...current, { id, ...box }])
      // Matches the `.visual-closing-box-fade` animation duration in App.css.
      window.setTimeout(() => setClosingBoxes((current) => current.filter((b) => b.id !== id)), 400)
    }

    prevConnectorsRef.current = paths
    prevStepIndexRef.current = clampedStepIndex
    pendingReturnOriginRef.current = currentReturnOrigin
    pendingClosingBoxRef.current = currentClosingBox

    setConnectorPaths(paths)
  }, [nextStepVarSource, nextStepDeclareTarget, nextStepPendingCall, nextStepFuncLookup, nextStepReturnFlight, currentTraceStep, openFrames, clampedStepIndex])

  // Keeps the currently executing line in view as steps advance, with
  // ordinary DOM scrolling - directly replacing the old Monaco
  // view-zone/content-widget machinery, whose geometry bookkeeping across
  // four separate systems was the root cause of the previous scrolling
  // bugs. It only scrolls when the active line would otherwise leave the
  // view (e.g. stepping into/out of a deeply nested call), rather than
  // jumping the view around on every single step.
  //
  // Horizontally, nested call boxes can be wider than the view (each one
  // sits at its call site, indented by the code before it), so it instead
  // follows the box the current step runs in: that box is scrolled fully
  // into view, outer boxes may slide off to the left, and if the box doesn't
  // fit (e.g. it already holds the next call's box) the innermost box wins.
  // Only steps scroll, so the learner can still scroll around in between.
  //
  // Both directions scroll only this view, never the page around it
  // (scrollIntoView would also scroll e.g. a LiaScript course page, even
  // across origins, moving the step buttons out from under the mouse).
  useEffect(() => {
    if (!isVisualizing) return
    const container = visualizerScrollRef.current
    const canvas = visualizerCanvasRef.current
    const root = canvas?.querySelector<HTMLElement>('.frame-box--root')
    if (!container || !canvas || !root) return
    const margin = 12

    let nextTop = container.scrollTop
    const line = root.querySelector<HTMLElement>('.visual-current-line')
    if (line) {
      const canvasTop = canvas.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
      const top = canvasTop + canvasOffset(line, canvas).top
      const bottom = top + line.offsetHeight
      if (top - margin < nextTop) nextTop = top - margin
      else if (bottom + margin > nextTop + container.clientHeight) nextTop = bottom + margin - container.clientHeight
    }

    const frameId = currentTraceStep?.frameId ?? 0
    const active = frameId === 0 ? root : root.querySelector<HTMLElement>(`.frame-box[data-frame-id="${frameId}"]`) ?? root
    // Open boxes form one chain, so there's at most one box without boxes inside.
    const innermost = [...root.querySelectorAll<HTMLElement>('.frame-box')].find((box) => !box.querySelector('.frame-box')) ?? null
    const span = (box: HTMLElement) => {
      const left = canvasOffset(box, canvas).left
      return { left, right: left + box.offsetWidth }
    }
    const room = container.clientWidth - 2 * margin
    let target = active !== root ? span(active) : innermost ? span(innermost) : { left: 0, right: 0 }
    if (target.right - target.left > room && innermost) target = span(innermost)
    if (target.right - target.left > room) target = { left: target.left, right: target.left + room }
    let nextLeft = container.scrollLeft
    if (target.left - margin < nextLeft) nextLeft = target.left - margin
    else if (target.right + margin > nextLeft + container.clientWidth) nextLeft = target.right + margin - container.clientWidth
    container.scrollTo({ left: Math.max(0, nextLeft), top: Math.max(0, nextTop), behavior: animationsEnabledRef.current ? 'smooth' : 'auto' })
  }, [isVisualizing, currentTraceStep])

  // While stepping through one visualization the canvas only grows: a call
  // box that opens makes it taller, but closing it again doesn't shrink it,
  // so a host whose height follows the content (the embed) doesn't jump up
  // and down with every box. In such a host (`compact`) it is as tall as the
  // tallest step from the start: the likely tallest steps are drawn once,
  // hidden, and measured (see steadyHeightCandidates), and the canvas keeps
  // the tallest of them; a step taller still makes it grow when it comes.
  // The host caps the visualizer's height (the embed: at most 80% of the
  // course window), so a taller canvas scrolls inside it, following the
  // current step (see above). A new trace or mode, and a new width (content
  // wraps differently), starts again.
  const steadyHeightRef = useRef(0)
  // The steps still to measure, for which trace, mode and width.
  const [steadyMeasure, setSteadyMeasure] = useState<{ trace: TraceResult | null; mode: VisualizerMode; width: number; pending: number[] }>({ trace: null, mode: 'box', width: 0, pending: [] })
  const steadyMeasureCurrent = steadyMeasure.trace === visualTrace && steadyMeasure.mode === effectiveMode
  const raiseSteadyHeight = (height: number) => {
    const canvas = visualizerCanvasRef.current
    if (!canvas || height <= steadyHeightRef.current) return
    steadyHeightRef.current = height
    canvas.style.minHeight = `${height}px`
  }
  useEffect(() => {
    const canvas = visualizerCanvasRef.current
    if (!isVisualizing || !canvas) return
    let width = -1
    steadyHeightRef.current = 0
    canvas.style.minHeight = ''
    const observer = new ResizeObserver(() => {
      if (canvas.offsetWidth !== width) {
        width = canvas.offsetWidth
        steadyHeightRef.current = 0
        canvas.style.minHeight = ''
        if (compact && visualTrace) setSteadyMeasure({ trace: visualTrace, mode: effectiveMode, width, pending: steadyHeightCandidates(visualTrace.trace, visualTraceSteps) })
      }
      raiseSteadyHeight(canvas.offsetHeight)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisualizing, visualTrace, effectiveMode, compact])
  const steadyMeasureRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const container = steadyMeasureRef.current
    if (!container || !steadyMeasureCurrent || steadyMeasure.pending.length === 0) return
    for (const step of container.querySelectorAll<HTMLElement>('[data-measure-step]')) raiseSteadyHeight(step.offsetHeight)
    const frame = requestAnimationFrame(() => setSteadyMeasure((measure) => ({ ...measure, pending: measure.pending.slice(STEADY_HEIGHT_BATCH) })))
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steadyMeasure])
  const steadyMeasureNode = steadyMeasureCurrent && steadyMeasure.pending.length > 0 && visualTrace ? <div className="visualizer-measure" ref={steadyMeasureRef} aria-hidden="true" inert style={{ width: steadyMeasure.width }}>{steadyMeasure.pending.slice(0, STEADY_HEIGHT_BATCH).map((index) => {
    const view = stepViewAt(visualTrace.trace, visualTraceSteps, index, astIndexByFile, substitutionMode, treeSteps?.episodes ?? null)
    const step = view.currentStep?.step ?? -1
    const access: FullValueAccess = { values: fullValuesUpTo(visualTrace.trace, step, visualTrace.values), trees: workspaceCapabilities.listTree ? valueTreesUpTo(visualTrace.trace, step, visualTrace.trees) : new Map(), showTrees: workspaceCapabilities.listTree && showListTrees, open: () => {}, t }
    return <div key={index} className="visualizer-canvas" data-measure-step={index}><FullValueContext.Provider value={access}>{rootFrame(view)}</FullValueContext.Provider></div>
  })}</div> : null

  const visualStepBack = () => setVisualStepIndex((index) => Math.max(-1, index - 1))
  const visualStepForward = () => setVisualStepIndex((index) => Math.min(visualTraceSteps.length - 1, index + 1))
  const visualFirstStep = () => setVisualStepIndex(-1)
  const visualLastStep = () => setVisualStepIndex(visualTraceSteps.length - 1)
  // The workspace's buttons, in the embed's order and with its labels. While
  // visualizing they stay (so nothing moves) and leave the visualizer first.
  // The run button holds both of its labels, the hidden one invisible, so it
  // keeps its width as ▶ becomes ■.
  const runFromActions = () => { if (isVisualizing) exitVisualizer(); runCode() }
  const testsFromActions = () => { if (isVisualizing) exitVisualizer(); runTests() }
  const actionsNode = workspaceCapabilities.actions ? <div className="editor-actions"><button className="run-button" onClick={showStopButton ? stopPython : isRunning ? undefined : runFromActions} aria-disabled={isRunning && !showStopButton}><span className="run-button-labels"><span aria-hidden={showStopButton}><Play size={15} fill="currentColor" /> {t.runProject}</span><span aria-hidden={!showStopButton}><Square size={13} fill="currentColor" /> {t.stop ?? 'Stop'}</span></span></button>{workspaceCapabilities.tests && <button className="secondary-button" onClick={testsFromActions} disabled={isTesting || inputRequest !== null}><FlaskConical size={15} /> {t.runTests ?? 'Tests'}</button>}{workspaceCapabilities.visualization && <button className="secondary-button" onClick={runVisualize} disabled={isRunning || isVisualizerLoading || inputRequest !== null}><Workflow size={15} /> {t.visualize}</button>}{workspaceCapabilities.resetOutput && <button className="secondary-button" onClick={resetPython}><RotateCcw size={15} /> {t.resetOutput}</button>}</div> : null
  const breadcrumbsNode = <div className="breadcrumbs"><span>{project.name}</span><span>/</span><strong>{selectedFile.path}</strong></div>
  const visualizerBarNode = <div className="visualizer-bar">{visualTraceSteps.length > 0 ? <><div className="visualizer-controls"><button type="button" className="icon-button small" aria-label={t.visualizerFirstStep ?? t.visualizerRestart} title={t.visualizerFirstStep ?? t.visualizerRestart} onClick={visualFirstStep} disabled={clampedStepIndex === -1}><SkipBack size={15} /></button><button type="button" className="icon-button small" aria-label={t.visualizerPrevStep} title={t.visualizerPrevStep} onClick={visualStepBack} disabled={clampedStepIndex === -1}><ChevronLeft size={15} /></button><button type="button" className="icon-button small" aria-label={t.visualizerNextStep} title={t.visualizerNextStep} onClick={visualStepForward} disabled={clampedStepIndex >= visualTraceSteps.length - 1}><ChevronRight size={15} /></button><button type="button" className="icon-button small" aria-label={t.visualizerLastStep ?? 'Last step'} title={t.visualizerLastStep ?? 'Last step'} onClick={visualLastStep} disabled={clampedStepIndex >= visualTraceSteps.length - 1}><SkipForward size={15} /></button></div><div className="visualizer-scrubber-track"><input className="visualizer-scrubber" type="range" min={-1} max={Math.max(0, visualTraceSteps.length - 1)} value={clampedStepIndex} onChange={(event) => { setVisualStepIndex(Number(event.target.value)) }} />{errorTraceStep && <span className="visualizer-scrubber-error" title={errorTraceStep.label} style={{ '--marker-position': (visualTraceSteps.indexOf(errorTraceStep) + 1) / Math.max(1, visualTraceSteps.length) } as CSSProperties} />}</div><span className="visualizer-step-count">{clampedStepIndex === -1 ? t.visualizerBeforeStart : t.visualizerStepOf(clampedStepIndex + 1, visualTraceSteps.length)}</span>{visualTrace?.truncated && <span className="visualizer-truncated-hint"><AlertTriangle size={13} />{t.visualizerTruncated}</span>}</> : <span className="visualizer-step-count">{t.visualizerNoSteps}</span>}<div className="visualizer-mode" role="group" aria-label={t.visualizerModeLabel ?? 'Display'}><button type="button" aria-pressed={effectiveMode === 'box'} onClick={() => changeVisualizerMode('box')}>{t.visualizerModeBox ?? 'Box'}</button><button type="button" aria-pressed={effectiveMode === 'substitution'} onClick={() => changeVisualizerMode('substitution')}>{t.visualizerModeSubstitution ?? 'Substitution'}</button>{workspaceCapabilities.tree && <button type="button" aria-pressed={effectiveMode === 'tree'} onClick={() => changeVisualizerMode('tree')}>{t.visualizerModeTree ?? 'Tree'}</button>}</div><OptionsMenu label={t.visualizerOptions ?? 'Options'}><button type="button" role="menuitemcheckbox" aria-checked={animationsEnabled} className="visualizer-options-item" onClick={() => setAnimationsEnabled((enabled) => !enabled)}><span className="visualizer-options-check" aria-hidden="true" />{t.visualizerAnimate}</button>{workspaceCapabilities.listTree && <button type="button" role="menuitemcheckbox" aria-checked={showListTrees} className="visualizer-options-item" onClick={() => setShowListTrees((shown) => !shown)}><span className="visualizer-options-check" aria-hidden="true" />{t.visualizerListTrees ?? 'Show lists as trees'}</button>}{workspaceCapabilities.export && <><button type="button" role="menuitemcheckbox" aria-checked={chainComments} className="visualizer-options-item" onClick={() => changeChainComments(!chainComments)}><span className="visualizer-options-check" aria-hidden="true" />{t.copyChainComments ?? 'Comments'}</button><button type="button" role="menuitem" className="visualizer-options-item visualizer-chain-copy" onClick={copyEvaluationChain} disabled={!canCopyChain}><Copy size={14} aria-hidden="true" />{chainFeedback === 'copied' ? (t.copyChainDone ?? 'Copied') : chainFeedback === 'failed' ? (t.copyChainFailed ?? 'Could not copy') : (t.copyChain ?? 'Copy \u2192 chain')}</button></>}</OptionsMenu>{workspaceCapabilities.exitVisualizer && <button type="button" className="icon-button small visualizer-exit" aria-label={t.exitVisualizer} title={t.exitVisualizer} onClick={exitVisualizer}><X size={16} /></button>}</div>
  const visualizerWarningNode = <>{isVisualizing && visualTrace?.error && !errorTraceStep && <div className="visualizer-warning"><AlertTriangle size={14} />{t.visualizerError(visualTrace.error)}</div>}</>
  const editorTabsNode = <div className="editor-tabs">{openFiles.map((path) => { const file = project.files[path]; return <button className={`editor-tab ${activeFile === path ? 'active' : ''}`} key={path} onClick={() => onOpenFile(path)}><span className={`tab-file-icon ${file.kind === 'python' ? 'python' : 'notes'}`}>{file.kind === 'python' ? <FileCode2 size={14} /> : <BookOpen size={14} />}</span><span>{file.path}</span>{file.readOnly && <span className="tab-read-only" role="img" aria-label={t.readOnlyFile ?? 'Read-only: this file can be read but not changed.'} title={t.readOnlyFile ?? 'Read-only: this file can be read but not changed.'}><Lock size={12} /></span>}{workspaceCapabilities.closeFileTabs && <span className="tab-close" role="button" aria-label={t.closeFile(file.path)} onClick={(event) => { event.stopPropagation(); onCloseFile(path) }}><X size={13} /></span>}</button> })}{isMarkdown && !isVisualizing && <div className="markdown-switch" role="group" aria-label={t.markdownViewLabel ?? 'Show the file'}><button type="button" aria-pressed={markdownView === 'page'} onClick={() => setMarkdownViews((views) => ({ ...views, [selectedPath]: 'page' }))}>{t.markdownPage ?? 'View'}</button><button type="button" aria-pressed={markdownView === 'text'} onClick={() => setMarkdownViews((views) => ({ ...views, [selectedPath]: 'text' }))}>{t.markdownText ?? 'Text'}</button></div>}</div>
  const editorWrapNode = <div className="editor-wrap">{isVisualizing ? <div className={`visualizer-view${animationsEnabled ? ' visualizer-animated' : ''}`} ref={visualizerScrollRef} data-steady-height={compact ? (!steadyMeasureCurrent || steadyMeasure.pending.length > 0 ? 'measuring' : 'done') : undefined}><div className="visualizer-canvas" ref={visualizerCanvasRef}><FullValueContext.Provider value={fullValueAccess}>{rootFrame(currentStepView)}</FullValueContext.Provider>{animationsEnabled && closingBoxes.length > 0 && <div className="visualizer-closing-boxes">{closingBoxes.map((box) => <div key={box.id} className="visual-closing-box-ghost" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} dangerouslySetInnerHTML={{ __html: box.html }} />)}</div>}{(connectorPaths.length > 0 || flights.length > 0) && <svg className="visualizer-connectors"><defs><marker id="visualizer-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>{connectorPaths.map((connector, index) => <path key={index} d={connector.d} markerEnd="url(#visualizer-arrowhead)" />)}{animationsEnabled && flights.map((flight) => <path key={`flight-${flight.id}`} className="visual-flight-arrow" d={flight.d} markerEnd="url(#visualizer-arrowhead)" />)}</svg>}{animationsEnabled && flights.length > 0 && <div className="visualizer-flights">{flights.map((flight) => <span key={flight.id} className="visual-flight-value" style={{ offsetPath: `path('${flight.d}')` }}>{flight.value}</span>)}</div>}</div>{steadyMeasureNode}</div> : <>{isMarkdown && markdownView === 'page' && <div className="markdown-page" tabIndex={0} aria-label={selectedPath} dangerouslySetInnerHTML={{ __html: markdownHtml }} />}<div className="editor-host" inert={isMarkdown && markdownView === 'page'}><Editor key="normal-editor" height="100%" language={selectedFile.kind === 'python' ? GLPYTHON_PYTHON : 'markdown'} theme={GLPYTHON_THEME} beforeMount={(instance) => { registerGlpythonPython(instance); defineGlpythonTheme(instance) }} value={selectedFile.code} onChange={updateCode} onMount={setNormalEditor} options={{ minimap: { enabled: false }, bracketPairColorization: { enabled: false }, fontSize: 15, lineHeight: 24, padding: { top: 22 }, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', scrollBeyondLastLine: false, smoothScrolling: true, automaticLayout: true, tabSize: 4, insertSpaces: true, detectIndentation: false, placeholder: t.editorPlaceholder ?? 'Type code here', unicodeHighlight: EDITOR_UNICODE_HIGHLIGHT, readOnly: selectedFile.readOnly === true, domReadOnly: selectedFile.readOnly === true, readOnlyMessage: { value: t.readOnlyFile ?? 'Read-only: this file can be read but not changed.' } }} /></div></>}</div>
  const consoleNode = <>{!hideOutputPanel && <section className="output-panel"><div className="output-heading"><div className="output-title"><SquareTerminal size={16} /><span>{t.output}</span>{runtimeState !== 'ready' && <span className={`runtime-badge${runtimeState === 'failed' ? ' runtime-badge--failed' : ''}`}><span className="pulse" /> {t.pyodideRuntime}</span>}</div>{Object.keys(project.files).length > 1 && <span className="output-hint">{t.runsFile(project.mainFile)}</span>}</div><div className="console" ref={outputRef} role="log" onScroll={(event) => { const element = event.currentTarget; consoleAtBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24 }}>{isVisualizing ? <pre className={compact ? 'visual-output-steady' : undefined}><span>{isAtErrorStep ? <>{visualStdout && !visualStdout.endsWith('\n') ? `${visualStdout}\n` : visualStdout}<span className="output-error">{visualTrace?.error}</span></> : visualStdout || t.noOutput}</span>{compact && <span className="visual-output-final" aria-hidden="true">{visualFinalOutput}</span>}</pre> : <><pre>{output}<ErrorHintNote hint={outputErrorHint} t={t} /></pre>{consoleEntries.map((entry) => entry.kind === 'tests' ? <div key={entry.id} data-console-entry={entry.id}><TestReportView report={entry.report} t={t} onVisualizeExample={workspaceCapabilities.visualization ? visualizeExample : null} /></div> : entry.kind === 'note' ? <p key={entry.id} className="console-note" role="note" data-console-entry={entry.id}>{entry.text}</p> : <pre key={entry.id} data-console-entry={entry.id}><ReplTranscriptEntry listTree={workspaceCapabilities.listTree} entry={entry} definitionHint={t.replDefinitionHint ?? 'Definitions belong in the file.'} t={t} onVisualize={workspaceCapabilities.visualization && entry.result && !entry.result.unparsed && !entry.result.untraced && !entry.stale ? () => visualizeReplEntry(entry.id) : undefined} busy={isBusy} /></pre>)}</>}{answeredInputLines.length > 0 && <pre className="console-answered">{answeredInputLines.join('\n')}</pre>}</div>{(workspaceCapabilities.repl || programInput) && <form className={`repl-line${programInput ? ' repl-line--program' : ''}`} onSubmit={(event) => { event.preventDefault(); if (programInput) respondToInput(false); else submitRepl() }}><span className="repl-prompt" aria-hidden="true">{programInput ? inputRequest : '>>>'}</span><input ref={inputFieldRef} className="repl-input" value={programInput ? inputValue : replInput} onChange={(event) => { if (programInput) { setInputValue(event.target.value) } else { setReplInput(event.target.value); setReplHistoryIndex(null) } }} onKeyDown={handleReplKeyDown} aria-label={programInput ? `${t.programInputLabel ?? 'Input for the program'}${inputRequest ? `: ${inputRequest}` : ''}` : t.replInputLabel ?? 'Python input'} spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off" enterKeyHint="send" /></form>}</section>}</>
  // In the stacked layout the graphics show only while the program draws -
  // for a visualization: if it draws at all, so the panel doesn't appear in
  // the middle of stepping. Its ✕ hides it until the next drawing.
  const drawsSomething = (isVisualizing ? visualTrace?.graphics.length ?? 0 : graphics.length) > 0
  const shownGraphics = isVisualizing ? (visualTrace?.graphics.slice(0, currentTraceStep?.graphicsLen ?? 0) as TurtleCommand[] ?? []) : graphics
  const stackedGraphicsNode = workspaceCapabilities.graphics && drawsSomething && !graphicsDismissed ? <aside className="graphics-panel"><div className="output-heading"><div className="output-title"><Sparkles size={16} /><span>{t.turtleGraphics}</span></div><button className="icon-button small" aria-label={t.collapseGraphics} title={t.collapseGraphics} onClick={() => setGraphicsDismissed(true)}><X size={15} /></button></div><GraphicsWindow commands={shownGraphics} /></aside> : null

  const workspaceClassName = [
    'glpython-workspace',
    isVisualizing ? 'glpython-workspace--visualizing' : '',
    compact ? 'glpython-workspace--compact' : '',
    workspaceCapabilities.actions ? '' : 'glpython-workspace--no-actions',
    workspaceCapabilities.editor ? '' : 'glpython-workspace--no-editor',
    workspaceCapabilities.exitVisualizer ? '' : 'glpython-workspace--no-exit-visualizer',
    workspaceCapabilities.breadcrumbs ? '' : 'glpython-workspace--no-breadcrumbs',
    workspaceCapabilities.fileTabs ? '' : 'glpython-workspace--no-file-tabs',
    workspaceCapabilities.resetOutput ? '' : 'glpython-workspace--no-reset',
    workspaceCapabilities.visualization ? '' : 'glpython-workspace--no-visualization',
    workspaceCapabilities.graphics ? '' : 'glpython-workspace--no-graphics',
  ].filter(Boolean).join(' ')

  return (
    <div className={workspaceClassName}>
              {compact ? <div className="main-split"><div className="editor-column"><div className="editor-header">{breadcrumbsNode}{isVisualizing || !actionsNode ? <div className="editor-actions" /> : actionsNode}</div>{isVisualizing && visualizerBarNode}{visualizerWarningNode}{(workspaceCapabilities.editor || isVisualizing) && <section className="editor-panel">{editorTabsNode}{editorWrapNode}</section>}{consoleNode}</div>{isGraphicsOpen ? <aside className="graphics-panel"><div className="output-heading"><div className="output-title"><Sparkles size={16} /><span>{t.turtleGraphics}</span>{graphics.length > 0 && <span className="runtime-badge"><span className="pulse" /> {t.gturtleWindow}</span>}</div><button className="icon-button small" aria-label={t.collapseGraphics} onClick={() => onGraphicsOpenChange(false)}><PanelRightClose size={15} /></button></div>{(isVisualizing ? (visualTrace?.graphics.slice(0, currentTraceStep?.graphicsLen ?? 0) as TurtleCommand[] ?? []) : graphics).length > 0 ? <GraphicsWindow commands={isVisualizing ? (visualTrace?.graphics.slice(0, currentTraceStep?.graphicsLen ?? 0) as TurtleCommand[] ?? []) : graphics} /> : <p className="graphics-empty">{t.graphicsEmptyBefore} <code>gturtle</code> {t.graphicsEmptyAfter}</p>}</aside> : <button className="graphics-collapsed-toggle" aria-label={t.expandGraphics} onClick={() => onGraphicsOpenChange(true)}><PanelRightOpen size={16} /><span>{t.graphicsCollapsedLabel}</span></button>}</div> : <><div className="workspace-stack" ref={stackRef}>{!actionsContainer && (actionsNode || workspaceCapabilities.breadcrumbs) && <div className="editor-header">{workspaceCapabilities.breadcrumbs && breadcrumbsNode}{actionsNode}</div>}<div className="stack-top" style={{ flexBasis: `${(1 - consoleShare) * 100}%` }}><section className="editor-panel"><div className="stack-strip">{isVisualizing ? visualizerBarNode : workspaceCapabilities.fileTabs ? editorTabsNode : null}</div>{visualizerWarningNode}{editorWrapNode}</section>{stackedGraphicsNode}</div><div className="stack-divider" role="separator" aria-orientation="horizontal" aria-label={t.consoleSize ?? 'Console size'} aria-valuemin={Math.round(CONSOLE_SHARE_MIN * 100)} aria-valuemax={Math.round(CONSOLE_SHARE_MAX * 100)} aria-valuenow={Math.round(consoleShare * 100)} tabIndex={0} onPointerDown={startConsoleResize} onKeyDown={resizeConsoleWithKeys} /><div className="stack-console" style={{ flexBasis: `${consoleShare * 100}%` }}>{consoleNode}</div></div>{actionsContainer && actionsNode && createPortal(actionsNode, actionsContainer)}</>}
      {isVisualizing && fullValueView && <FullValueDialog value={fullValueView.value} name={fullValueView.name} tree={fullValueView.tree} t={t} onClose={() => setFullValueView(null)} />}
      {inputRequest !== null && !programInput && <div className="input-dialog-backdrop" role="presentation" onClick={() => respondToInput(true)}><form className="input-dialog" role="dialog" aria-modal="true" aria-label={t.inputDialogTitle} onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); respondToInput(false) }}><div className="input-dialog-heading"><Terminal size={16} /><span>{t.inputDialogTitle}</span></div><p className="input-dialog-prompt">{inputRequest || t.inputDialogFallbackPrompt}</p><input ref={inputFieldRef} className="input-dialog-field" type="text" value={inputValue} onChange={(event) => setInputValue(event.target.value)} placeholder={t.inputPlaceholder} /><div className="input-dialog-actions"><button type="button" className="secondary-button" onClick={() => respondToInput(true)}>{t.inputCancel}</button><button type="submit" className="run-button">{t.inputSubmit}</button></div></form></div>}
    </div>
  )
}

export { GlPythonWorkspace }
export type { GlPythonWorkspaceProps, CoreStrings, ReplReplayNote, WorkspaceCapabilities, WorkspaceCommand }
