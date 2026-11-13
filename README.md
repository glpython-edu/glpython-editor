# glpython-editor

Embeddable Python editor + step-by-step execution visualizer + turtle graphics
panel, extracted from the [glpython IDE](https://glpython-edu.github.io/)
([repo](https://github.com/glpython-edu/glpython-edu.github.io)) so it can be
reused in different host applications ("shells").

This package owns:

- The Monaco-based code editor and tabs for a `Project`'s files.
- The "Run" / "Visualize" workflow, backed by a Pyodide web worker.
- The step-by-step AST execution visualizer (`Frame`, substitutions,
  animated value flights, closing boxes, etc).
- The turtle graphics panel (`GraphicsWindow`), shown when the running
  program imports `gturtle`.

It deliberately does **not** own: top bar / navigation, sidebar / file tree,
authentication, locale switching, or project persistence/sharing — those are
shell concerns and stay in the host application.

## Installation

This package is not published to the npm registry. Install it directly from
a tagged commit on GitHub:

```json
{
  "dependencies": {
    "glpython-editor": "git+https://github.com/glpython-edu/glpython-editor.git#v0.1.9"
  }
}
```

Installing from git automatically runs `npm run build` via the `prepare`
script, so `dist/` is generated on install.

### Peer dependencies

The host application must provide these (they are not bundled):

- `react` / `react-dom` (^19)
- `@monaco-editor/react` (^4.7)
- `lucide-react` (^1.47)

## Usage

```tsx
import { GlPythonWorkspace, initialProject, type CoreStrings } from 'glpython-editor'
import 'glpython-editor/style.css'

function Shell() {
  const [project, setProject] = useState(initialProject)
  const [activeFile, setActiveFile] = useState(project.mainFile)
  const [openFiles, setOpenFiles] = useState([project.mainFile])
  const [isGraphicsOpen, setIsGraphicsOpen] = useState(false)

  return (
    <main className="main-area">
      <GlPythonWorkspace
        project={project}
        activeFile={activeFile}
        openFiles={openFiles}
        onOpenFile={(path) => {
          setActiveFile(path)
          setOpenFiles((files) => (files.includes(path) ? files : [...files, path]))
        }}
        onCloseFile={(path) => {
          setOpenFiles((files) => files.filter((f) => f !== path))
        }}
        onFileCodeChange={(path, code) => {
          setProject((p) => updateProjectFile(p, path, code))
        }}
        isGraphicsOpen={isGraphicsOpen}
        onGraphicsOpenChange={setIsGraphicsOpen}
        t={coreStrings}
      />
    </main>
  )
}
```

`t` must implement the `CoreStrings` interface (all UI strings used inside
the workspace), so the host application controls localization.
`visualizerCollapsedCalls` is optional; without it, an English fallback is
used.

### Visualizing failing programs

When a program raises an exception, the visualizer still shows every step up
to the failure. The trace ends in one `error` step at the expression that
raised, in the call frame it was raised in. It still starts before the first
step; a red marker on the scrubber shows where the failure is. At that step the
expression is marked red with Python's untranslated last traceback line below
it, and the output panel shows a traceback of the learner's own lines.
`TraceResult` carries that traceback as `error` and its last line as
`errorMessage`. A `SyntaxError` produces no steps and keeps the warning banner.

Deep chains of open calls, such as a recursion without a base case, collapse
their middle boxes into one "… N more calls of f(x) …" marker
(`visualizerCollapsedCalls`), so the layout stays usable.

A call ends as its value, `None` too: also a call that is a whole statement
(a line of the program, a REPL input, a doctest example), when it calls the
learner's own function - a `def` or lambda of the project's files, of a
library loaded with it, a method of their class - so a function without a
matching `return` visibly gives `None`. Only a built-in, a method of a
built-in type or a function of a module that comes with Python or glpython
(`print(...)`, `xs.append(x)`, `random.shuffle(xs)`, `gturtle`) keeps its call
text as a statement, where `None` would only be noise. The console still
shows nothing for `None`, as CPython's REPL.

### Box and substitution mode

The visualizer's toolbar is one line: first step, previous step, next step,
last step, the scrubber, the step counter, the box/substitution switch, the
**⋯ Options** menu (animated steps, and with `export` the → chain's comments and
copy button) and ✕ to exit (`visualizerFirstStep`, `visualizerLastStep`,
`visualizerOptions`; ✕ uses `exitVisualizer`).

A call box lists its variables in a row below its code; the box of the current
call, when it's taller than the view, keeps that row at the view's bottom edge
while the box is on screen. The file's (global) variables are in a footer below
the code that doesn't scroll with it, at every width, so the code has the full
width: name and value (`auswerten Funktion`, `x 3`) in a row that wraps, at
most about three lines high (then it scrolls). A program without global
variables has no footer; one with them has it from the start, as tall as at
the last step. Hovering over an entry, tapping it (touch) or focusing it opens
a box over the code, upwards from the pointer and inside the visualizer (at
most its width and ⅔ of its height, scrolling inside): a function's (or
class's) whole definition, highlighted, also while it's open as a call box; any
other value in full. The box stays while the pointer moves into it; it closes
when the pointer leaves both, on a tap elsewhere or with Escape. Arrows from a
call to a global function, and between a global variable and the code, end at
its entry in the footer. Text: `visualizerGlobals` (the footer's label for
screen readers), optional.

The toolbar switches between two ways of showing a function call.
In **substitution** mode (the default), a call to a function whose body is a
single `return <expression>` (optionally after a docstring) is replaced at its
call site by that expression, with its parameters already replaced by their
values, as in the course's paper notation:
`quadrat(a + 2) → quadrat(5 + 2) → quadrat(7) → 7 * 7 → 49`. Every click is one
substitution, and a replacing expression gets parentheses where an operator
works on it (`1 * (3 * 2)`). Any other function still opens a box, and the
outermost box says why at its top: `notenschnitt hat lokale Variablen – der
Aufruf wird als Kasten gezeigt.` (`visualizerBoxReason`, one sentence per
reason: local variables or a loop, an `if` choosing what runs, several
statements, no `return <expression>`, an expression that can't be written out;
the runtime's `boxReason` on the call's step). In **box** mode every call opens
a box.

The mode last chosen is remembered per browser. A host can preset it with the
`visualizerMode` prop (`'box'`, `'substitution'` or `'tree'`), and the embed with
the `visualizer=box`, `visualizer=substitution` or `visualizer=tree` query
parameter. The toggle's texts are `visualizerModeLabel`, `visualizerModeBox`,
`visualizerModeSubstitution` and `visualizerModeTree`, all optional like
`visualizerBoxHint` (the box's note without a reason).

### Tree mode (`tree`)

With the capability `tree` (off by default; the embed's `features=tree`), the
switch has a third mode, **Baum**: an expression is shown as its syntax tree
while it is evaluated. Without the capability there is no third button, and a
stored or preset `'tree'` shows the substitution mode. For an expression `e`
(the value of an expression statement, an assignment or a `return`, an `if`'s
or `while`'s condition; not a bare name or literal):
1. **Open:** one step replaces `e` by its tree, in a box at its place in the line.
2. **Reductions:** exactly the substitution mode's steps, each one a subtree
   becoming its value; a node without a step of its own (a display, `-x`)
   becomes its value with its last child. A call with a single
   `return <expression>` is replaced by that expression's tree. Any other
   call, once its box opens, has the box in its node's place - the parent's
   edge leads to the box's top, its siblings stay on their row - without
   the note of the substitution mode (the box in the call's place shows it
   stays a box); inside it, each line has its own tree and calls of their
   own boxes.
3. **Close:** one step from the trivial tree to the value in the line.

For a call of a function of the program's own, each edge to an argument is
labelled with the parameter it binds to (`summe(2 + 2, 3 * 4)` with
`def summe(x, y)`: `x` on the edge to `2 + 2`, `y` on the one to `3 * 4`),
while the node keeps the function's name. A keyword argument is labelled with
its parameter, a parameter left to its default has no edge, and there are no
labels after a `*args` or for `**kwargs`; built-in and library functions
(`len`, `max`) have none. The labels stay while the arguments are reduced,
until the call is replaced or its box opens. They sit in the gap above the
argument, beside the edge's end, in a smaller code font; the layout keeps
room for them, so they touch no node and no other label.

So `x = 2 + 3 * 4` takes 5 steps instead of 3. Labels are Python's (`+`,
`quadrat`, `[ ]`, a name is a leaf); there are no parentheses, so
`(2 + 3) * 4` and `2 + 3 * 4` differ only in shape. A tree keeps its nodes in
place from step to step: it is laid out where it opens, where a call is
replaced and where a call's box opens and closes, with room for the widest
value each node takes. A box is measured as drawn; while it is open, the tree
moves only if the box grows (a line of it gets longer, a tree opens in it)
and never when it shrinks again. With the
visualizer's animations, a reduced subtree's nodes move up into it and fade
(not with reduced motion). For screen readers each tree is described by its
text at that step, as the → chain writes it; a tree wider than the visualizer
scrolls as in `listTree` (root in the middle, hints at the edges, arrow keys).
The steps come from `treeModeSteps`, the trees from `buildExpressionTree`
(`src/treeMode.ts`); `npm run test:tree` checks them on traces of the runtime.

### Lists and long values

Indexing a variable is one step to the element, in both modes:
`dauer[0] + dauer[1] → 1 + dauer[1] → 1 + 2 → 3`, while the list itself stays in
the variables panel. The same holds for a tuple, a string or a dict, and for a
slice (`w[1:3]`). A variable passed to a call is still replaced by its value
(`notenschnitt(noten) → notenschnitt([5, 4.5, 6])`), and so is a parameter in a
substituted function's expression. A list written out and indexed directly
is one step too: `[1, 2, 30][1] → 2`.

A list, tuple, set or dict written out has no step of its own: once its parts
are values, it reads as its value, as on paper. So a display of literals has
no steps at all, nested at any depth and with negative numbers (`-3`, `-2.5`):
`baum = ["+", ["*", 2, ["-", 7, -3]], 4]` is one step, the assignment. Otherwise
only the parts that change have steps: `[1 + 2, 3, 4] → [3, 3, 4]`,
`["+", 1, ["*", n, 3]] → ["+", 1, ["*", 2, 3]]`. A display keeps its step only
where its value reads differently: unpacking (`[*a, 2] → [1, 2]`) and a set or
dict whose duplicates go (`{1, 1} → {1}`). Likewise `-x` with `x = 7` is one
step, to `-7`; the minus has a step of its own only where it changes what is
shown (`-x` with `x = -7` reads `--7`, then `7`).

A long value is abbreviated, in the step and in the variables panel alike,
keeping its first elements and its last one: `[1, 2, 3, 4, 5, …, 100]`.
- **Shown completely:** a list, tuple, set or dict of up to 10 elements, in a
  value of up to 160 characters (so are the course's expression trees, e.g.
  `['+', ['*', 2, ['-', 7, 3]], ['/', ['+', 1, 2], 3]]`), and a string of up to
  80 characters.
- **Abbreviated:** a longer container keeps its first 5 elements and its last.
  If that is still longer than 160 characters, it keeps fewer and shortens long
  elements too. A long string is shortened in the middle.
- **In full:** an abbreviated value is underlined with dots. A click (or Enter)
  shows it in full, with its number of elements or characters (`100 Werte`,
  also below it in a call box's variables). A global variable's box (in the
  footer) shows it in full, with its length. The runtime keeps up to 50 000
  characters of it.

A long value in a line wraps within the code instead of running on below the
variables panel. Texts: `visualizerShowFullValue`, `visualizerValueLength`,
`visualizerFullValueTitle`, `visualizerFullValueCut`, `visualizerCloseFullValue`,
all optional.

### Lists as trees (`listTree`)

With the capability `listTree` (off by default; the embed's `features=listtree`),
a list that reads as a tree is drawn as one, below its text: a non-empty list
whose first element is a string is a node with that label, its other
elements are its children, a subtree where they read as a tree too, else a
leaf. `['+', ['var', 'x'], ['f', 1, 2]]`:

```
        +
      ╱   ╲
   var     f
    │     ╱ ╲
   'x'   1   2
```

Labels have no quotes, string leaves do. The rule is generic, so `['Anna', 'Ben']`
is drawn too; the text stays as it is. Where:
- **Variables of a call box:** below the value; a tree wider than the panel
  (48 characters) has a link «Baum zeigen» (`showTree`) to the full-value
  dialog instead. A global variable's tree is in its box (hover or tap its
  entry in the footer), below the full value. The options menu's «Listen als
  Baum zeigen» (`visualizerListTrees`) switches the trees off and on.
- **Full-value dialog:** below the value's text.
- **REPL:** a value that reads as a tree has a «Baum» button (`replShowTree`)
  next to «Visualisieren»; it shows the tree below the value and hides it
  again.

A tree of more than 100 nodes, deeper than 10 or containing itself isn't
drawn; long labels and leaves are shortened in their middle. For screen
readers each tree is an image described by the list's text. A tree wider
than its place (the console, the dialog, a global variable's box, a narrow
panel) scrolls sideways:
it starts with its root in the middle, a ‹ or › at an edge shows that more is
hidden there, and it takes the focus, so the arrow keys, Home and End scroll
it. The positions come from the package's own implementation of van der Ploeg's
tidy-tree algorithm for nodes of different widths (`src/treeLayout.ts`,
checked against [d3-flextree](https://github.com/Klortho/d3-flextree)), in
characters of the code font, so a tree scales with the text around it.

### Static tree pictures (`glpython-editor/tree-svg`, `glpython-tree`)

For slides, handouts and quiz options, a list that reads as a tree can also be
drawn as a static SVG file, without a browser: the same tree rule and layout as
`listTree`, the same look (solid node boxes, dashed leaf boxes, the light
theme's colours) on a light card with rounded corners, so the picture reads the
same on a light and a dark page.

```js
import { renderTreeSvg } from 'glpython-editor/tree-svg'

const svg = renderTreeSvg("['+', 2, ['*', 3, 4]]", { mark: ["['*', 3, 4]"], lang: 'de' })
```

```sh
npx glpython-tree "['+', 2, ['*', 3, 4]]" --mark "['*', 3, 4]" -o baum.svg
```

- **Input:** the list as Python writes it: numbers (also negative and
  decimal), strings in single or double quotes with Python's escapes, `True`,
  `False`, `None`, lists and tuples. Leaves read as Python's repr writes them
  (`2.50` → `2.5`, `"it's"`). A single value is a tree of one leaf.
- **`mark`:** subtrees to highlight, written the same way (the accent colour on
  their boxes and the edges between them; the whole tree marks all of it). A
  mark that isn't a subtree, or occurs more than once, is an error.
- **`markRoot`:** the root node's box alone (not its edges or children), e.g.
  for the operator computed last; it combines with `mark`, and marks the leaf
  of a single value. In the description: «– markiert: Wurzel» / «– marked:
  root» (first, before the marked subtrees). `glpython-tree --mark-root`.
- **`fontSize`** in pixels (default 16), **`lang`** (`en`, `de`) for the
  description. The picture is `role="img"` with a `<title>`: the list, and
  «– markiert: …» / «– marked: …» for the marks.
- **Text and errors:** widths are in characters of the code font, as on screen;
  each text is fitted to its characters' width (`textLength`), so a monospace
  font with other proportions doesn't overflow its box. Invalid input throws a
  `TreeSvgError` naming the position; `glpython-tree` prints it and exits
  with 1 (2 for wrong usage). Without a list it reads one from stdin.
- **Deterministic:** the same input and options always give the same bytes.

Long labels aren't shortened, unlike the visualizer's trees.
`npm run test:svg` checks the pictures against `scripts/tree-svg/`.

### Copying the evaluation as a → chain

The **Copy → chain** item in the toolbar's **⋯ Options** menu copies the whole evaluation of the
statement the scrubber is on - from its first step to its value, at whichever of its steps the
scrubber is (for a visualized REPL entry: that input) - in the course's
paper notation: its expression, then one line per change, each starting with
`→`, taking the same steps as the visualizer. A call to a function with a single
`return <expression>` is replaced as in substitution mode. Any other call is
replaced by the expression of the return it executed, with its parameters and
local variables already filled in, and a comment naming the condition that
chose that return (`# 2 == 0 is False`) and whether its body has local
variables. A failing run ends with Python's error line. Definitions are never
exported. The menu's **Comments** item turns the comments off; it is remembered per
browser. Texts: `copyChain`, `copyChainDone`, `copyChainFailed`,
`copyChainComments`, `chainConditionComment`, `chainLocalsComment`.

### Tests (doctests)

The **Tests** button (capability `tests`, a `test` command for editor-free
hosts) starts as **Run** does - an empty console and a fresh session from the
current files, whose output shows first and whose definitions the REPL has
afterwards - and then runs the doctests in the docstrings of the file that would
run, as `python -m doctest` does: the file is loaded once more as a module named
after it (its output there isn't shown again). If the file itself fails, its
traceback is the answer and no report follows. The console then shows how many
examples passed, then each failing example in doctest's own words (`Failed
example:`, `Expected:`, `Got:` stay untranslated) with a button that visualizes
that example step by step against the same definitions. If the example didn't
raise, the visualization's last step shows the two texts doctest compared next
to the final value (`exampleGotExpected`, e.g. «Erhalten: 4.5 · Erwartet: 4»).

Unlike Python's doctest, an example compares **values, not their display**:
when the expected text and the output are each one Python literal (numbers,
strings, lists, tuples, dicts, sets, `True`/`False`/`None`, nested), it passes
if the two values are equal with `==` - `4` for `4.0`, `[1,2,30]` for
`[1, 2, 30]`, `["+", 1]` for `['+', 1]`, and, as `==` says, `1` for `True`
(no tolerance: `0.3` for `0.1 + 0.2` fails). Anything else - exceptions,
several lines of output, objects such as `<function f at 0x…>`, other text -
and an example with a comparison flag of its own (`ELLIPSIS`,
`NORMALIZE_WHITESPACE`, …) is compared as doctest does. The report shows both
texts as written. An example that printed
what was expected but returned `None` passes, as in doctest, with a separate
glpython hint that it probably should `return` instead. Texts: `runTests`,
`testsRunning`, `testsSummary`, `testsNone`, `testsLoadError`,
`visualizeExample`, `testsPrintHint`.

**Coverage** (capability `coverage`, off by default): when all examples pass,
the report also lists which lines of the tested file's functions no example
executed, each with its code («Zeile 11: `return "ungenügend"`»; consecutive
lines of one function as «Zeilen 8–12:»), in a pale orange box like their
marks in the editor. Counted are the statements in
function bodies (also methods and nested functions), as Python's own `trace`
module counts them during the examples - not `def` lines, docstrings, code
outside functions, or other files such as libraries. With the editor, the same
lines are marked in it (line background and a bar in the gutter) until the
file is edited or the program runs again. When every line ran, a light blue
note (`--glp-info`, never green like «bestanden») says so and that this doesn't show whether the examples check the edge cases:
coverage finds untested code, not wrong code. Recorded with `sys.monitoring`,
each line once, so it doesn't slow the examples down. Texts:
`testsUncoveredHeading`, `testsUncoveredLines`, `testsAllCovered`.

Call boxes in the visualizer show a function without its comments and
docstring, which don't change what runs; the file itself is shown as written.

### Error hints

Below an error, glpython adds one short hint for the unit's common mistakes:
an undefined name, missing or too many arguments, a `None` operand (a
function that prints instead of returning), text plus a number, a division
by zero, endless recursion, a list index out of range, a doctest example
without a blank after `>>>`, and `input()` where the page can't wait for an
answer (see `input()` below). Python's message and traceback stay exactly as
they are, and a failing test still fails. A hint is matched on the
exception's type and message (`src/runtime/hints.py`); anything else gets no
hint. It shows in the Run output, the REPL, the Tests report and below the
visualizer's error marking, worded by `errorHint` and labelled by
`hintLabel` («Hinweis:» / "Hint:"); a host without `errorHint` shows none.

In the visualizer, a call with the wrong arguments fails as in Python, with
Python's own `TypeError`.

### Console and Stop

The console (`output`: «Konsole») is one chronological transcript, like Python
in a terminal: what the program printed - shown while it runs, not only at the
end - then every REPL input with its answer, every Tests report and every note,
in the order they happened. Errors and their hints stand where they happened.
Run and Reset clear it. It keeps the last 100,000 characters of a long output.

While Python is busy for more than a moment (a program, a REPL input, Tests,
a visualization), the run button becomes **Stop** (`stop`: «Stoppen»). Stopping
ends Python's worker and starts a new one: the code stays, the console keeps
what was printed and adds `stoppedNote`, and the REPL starts in an empty
namespace (earlier entries can't be visualized anymore). Hosts can stop with
the command `{ id, type: 'stop' }` (and restart Python with an empty console,
as Reset does, with `{ id, type: 'reset' }`), and learn when Python is busy through the
`onBusyChange` prop.

### REPL

Below the console, a `>>>` input line runs Python in the namespace of the
last Run, so learners can call the file's functions directly. As in
`python3 -i main.py`, that namespace is the module `__main__`: the file runs
with `__name__ == "__main__"`, and `import __main__; __main__.x` sees its
variables, in the REPL, the visualizer and the Tests' Run too (before any
Run, the REPL's own namespace is `__main__`). An expression
shows its value, except `None`, as in CPython's REPL (so a call of a function
without `return`, `print(...)` or `help(...)` shows only what it printed); a
statement such as `a = 5` shows
nothing; a `def` runs but adds the hint `replDefinitionHint`; an error shows
Python's last traceback line. Run starts a fresh namespace and clears the
transcript, while arrow up/down still recalls earlier inputs. Every entry of
the transcript has a **Visualize** button (`replVisualizeEntry`) that traces
that input step by step, an entry with an error up to its error, with call
boxes drawn from the file as it was at the last Run. It replays rather than
stores Python's state: the worker runs that file and the inputs before the
entry again, in a namespace of its own, and checks that each prints and
evaluates to what it did the first time. If the replay needs `input()` or
comes out differently (e.g. random numbers), the entry shows a note
(`replReplayNote`) instead of a visualization. The live namespace stays as
it was. An input that doesn't compile has no button. Disable the REPL with
`capabilities={{ repl: false }}`; the embed shows it in `eval` mode only, and
resetting the embed discards the namespace.

### `input()`

A program (or a REPL input such as `repl()`) that calls `input(prompt)` asks in
the console, as in a terminal: while it waits, the `>>>` line becomes the
program's input line, with the prompt in front of it and the cursor in it
(`programInputLabel` for screen readers). Enter sends the line; the prompt and
the answer then stay in the transcript as one line (`> 2 * 3`), followed by
what the program prints. Python's `input()` and the transcript otherwise behave
as in a terminal: the answer comes without the newline, a recursive REPL of
the learner's own works, and **Stop** (or Ctrl+D in an empty line) ends the
wait with `EOFError: EOF when reading a line`, which the program can catch -
Python isn't restarted then. Tests ask the same way (the file runs first, as
with Run), and the visualizer asks while it records the run, then shows the
steps; the `input(...)` call is one step with the typed text as its value.
Only a host that hides the console (no REPL and no `emptyOutput`, during a
visualization without output) asks in a dialog (`inputDialogTitle`, …) instead.

`input()` needs cross-origin isolation (see below). Without it, the program
stops with `RuntimeError: input() is not available here` and the hint
`input-unavailable` («`input()` funktioniert hier nicht … In der IDE fragt die
Konsole danach.»). That is the case in an embed inside LiaScript.

### Stacked layout (the IDE)

Without `compact`, the workspace is stacked: the editor (or, while
visualizing, the visualizer) in full width on top, a divider, and the console
in full width below. The divider can be dragged (mouse, pen or finger) or
moved with the arrow keys, Page Up/Down, Home and End (`consoleSize` names
it); the console's share of the height (a third at first) is remembered in
the browser. The file tabs and, while visualizing, the visualizer's bar take
the same strip above the editor, so nothing below moves when switching. The
graphics show beside the editor only while the program draws (for a
visualization: if it draws at all); their ✕ hides them until the next drawing.
An empty editor shows `editorPlaceholder` («Code hier eingeben»).

The buttons come in the embed's order and labels - **▶ Run · Tests ·
Visualize · Reset** (`runProject`, `runTests`, `visualize`, `resetOutput`) -
and stay while visualizing (they leave the visualizer first). **Reset**
restarts Python and clears the console, the visualization and the drawing, as
the embed's Reset does. The run button keeps its width when it becomes
**Stop**. A host can put the buttons into its own bar with
`actionsContainer={element}` (the IDE's top bar); without it they sit above
the editor. `capabilities={{ closeFileTabs: false }}` drops the ✕ on the file
tabs, for a host that shows every file of the project as a tab.

A file with `readOnly: true` (`ProjectFile`) is one to read, not to change,
e.g. a course's library that learners use as a black box: the editor shows it
read-only (on an iPad the keyboard doesn't open), its tab has a lock
(`readOnlyFile`, also the message when typing into it), and
`updateProjectFile`, `renameProjectFile` and `deleteProjectFile` leave it
as it is. It runs, imports and visualizes like any other file.

### Compact embeds

`GlPythonWorkspace` accepts optional `compact` and `capabilities` props. The
existing behavior remains the default. A compact host can explicitly disable
the editor, built-in action buttons, breadcrumbs, file tabs, output reset,
visualization, visualizer exit action, or graphics. An editor-free host can
send immutable `command` events to run or visualize a source snapshot supplied
by its parent:

```tsx
<GlPythonWorkspace
  {...props}
  compact
  command={{ id: commandId, type: 'run' }}
  capabilities={{
    actions: false,
    editor: false,
    exitVisualizer: false,
    breadcrumbs: false,
    fileTabs: false,
    resetOutput: false,
    visualization: true,
    graphics: false,
    emptyOutput: false,
  }}
/>
```

Each of the built-in buttons has its own switch: `run` (▶; without it, the
button still appears as ■ Stop while Python is busy, e.g. with Tests),
`tests`, `visualization` and `resetOutput`; `repl: false` hides the REPL's
input line but keeps the console (output, and `input()`'s line when a program
asks). A host can thus show e.g. «Tests» without ▶, or ▶ without «Tests».

With `emptyOutput: false` (the embed's `visual` mode), a visualization whose
program prints nothing and raises no error has no output panel instead of
«(Keine Ausgabe)», so short visualizations take less space. It is decided for
the whole run, so the panel doesn't appear in the middle of stepping. With the
REPL on, the panel always stays, since it holds the REPL's input line.

This repository also contains a standalone iframe application:

```bash
npm run dev:embed
npm run build:embed
npm run preview:embed
```

The built app is emitted to `dist-embed/`. `embed/demo.html` is a small parent
page that exercises the eval, turtle, and visualization-only modes.

It is hosted in two channels: the live embed from `main` at
https://glpython-edu.github.io/glpython-editor/index.html, and the dev channel
from `dev` at https://glpython-edu.github.io/glpython-editor/dev/index.html,
built with `GLPYTHON_CHANNEL=dev` so that it shows a «dev» badge. A push to
`dev` never changes the live embed. The LiaScript macro loads the dev embed
when its flag is set (see the macro's README).

The iframe requires a `parentOrigin` query parameter containing the exact
origin that is allowed to communicate with it:

```text
https://example.test/embed/?parentOrigin=https%3A%2F%2Fcourse.example
```

Optional query parameters adapt the embed to a host such as the LiaScript
macro: `features=run,repl,visualize,…` hides the REPL (`repl`), the visualizer
(`visualize`) or its → chain export (`export`) unless listed (capabilities
`repl`, `visualization`, `export`); `coverage` in that list switches on the
coverage after Tests (capability `coverage`), `listtree` lists drawn as
trees (capability `listTree`) and `tree` the visualizer's mode «Baum»
(capability `tree`), which a missing `features` doesn't; and `size=large`
shows bigger code.

**Its height is the parent's.** The embed fills its iframe and reports the
height its content needs in `glpython:resize` (`height`; since v0.1.35 also
`visualizing`, whether the visualizer is open) - its natural height, also
while the iframe is smaller or taller. A parent sets the iframe to that
height, or less: the LiaScript macro gives it at most 80% of the course's
visible height (with `large` while visualizing exactly that). In a smaller
iframe the visualizer's code area scrolls, between the step bar and the
global variables' footer, which stay in view, and follows the current step;
without the visualizer the console scrolls. A taller iframe (`large`) is
filled by the code area. Scrolling past the code's end goes on with the
page around it. The old `windowHeight` and `visualizerHeight` parameters are
ignored.

**A steady height.** The embed's height follows its content, so the page
around it would move with every step. While visualizing, it doesn't: the
visualizer is as tall as its tallest step from the start, and the console as
tall as the output at the last step. The workspace draws the likely tallest
steps once, hidden, and measures them: every step of a short trace, else the
120 with the most open calls and some spread over the trace. A step taller
still makes it grow when it comes, and it never shrinks while stepping. A
step taller than the iframe scrolls inside the visualizer, which follows the
current step. A new visualization, a switch of the mode, and a new width
start again. This applies to `compact` hosts (the embed); in the IDE the
visualizer has a fixed height and scrolls already.

The UI language is the optional `lang` query parameter (e.g. the LiaScript
course's language), else the browser's language, else English; only the
primary subtag counts (`de-CH` → German), and an unsupported language (e.g.
`fr`) falls through to the next step. The UI strings live in `src/i18n.ts`
(`coreStrings`, German and English), which the glpython IDE imports too;
`resolveUiLocale` implements this order for any host. Python's own values and
error messages are never translated.

It sends `glpython:ready` with runtime capabilities, accepts versioned
`glpython:load`, `glpython:run`, `glpython:visualize`, and `glpython:reset`
messages, and sends `glpython:resize` as its content size changes. `run` and
`visualize` carry the current source snapshot so a parent such as LiaScript can
remain the authoritative editor and restore its own PWA state. The public TypeScript types and validators are exported from
`glpython-editor`.

Protocol version 2 adds programs of several files: `load`, `run` and `visualize`
may carry `files` (`{ path, source }`, each path a Python module name such as
`parser.py`, at most `GLPYTHON_MAX_FILES`) and `mainFile`, the file to run;
`source` stays the code of that file. Only the file to run is traced; imported
files run as a black box. Version 3 adds `glpython:test` (same fields as
`run`), which runs the doctests of that file. The embed still accepts every
earlier version and answers every parent in the version that parent last used
(version 1 until it hears otherwise), so older parents keep working.
Version 4 adds `glpython:stop`, which stops what Python is running by
restarting it (the source stays), and `glpython:busy` (`busy: true|false`),
which the embed sends to a version 4 parent when Python has been busy for more
than a moment (a program, a REPL input, Tests, a visualization), so the
parent's run button can become a stop button, as the workspace's own does.
`glpython:ready` reports `capabilities.files`, `capabilities.tests` and
`capabilities.stop`.

```ts
iframe.contentWindow?.postMessage({
  type: 'glpython:run',
  version: GLPYTHON_EMBED_PROTOCOL_VERSION,
  source: 'print("Hello")',
  mode: 'eval',
}, iframeOrigin)
```

Use `mode: 'turtle'` for the graphics layout. The eval layout does not show or
reserve space for turtle graphics. Use `mode: 'visual'` with a
`glpython:visualize` message for an editor-free visualizer that cannot exit to
the normal workspace.

### Look

Every colour, font and the corner radius in `style.css` come from CSS
variables defined on `:root` with glpython's own look (the course design:
white panels, light grey code areas, ink accent `#1F3A5F`, the system's UI
and monospace fonts, no web fonts). A host can override any of them:

| Variable | Role |
|---|---|
| `--glp-bg` | panel background |
| `--glp-surface` | code in the visualizer, output, REPL |
| `--glp-border` | decorative borders and separator lines |
| `--glp-border-control` | borders of controls, call boxes in box mode |
| `--glp-text`, `--glp-text-muted` | text and code; line numbers, step counter, secondary info, connector lines |
| `--glp-accent`, `--glp-on-accent` | active mode, scrubber, focus, primary button; text on it |
| `--glp-current`, `--glp-current-outline` | current subexpression and new value, current line; next step (dashed) |
| `--glp-error`, `--glp-error-bg` | errors, failing tests, «Erhalten · Erwartet» |
| `--glp-warning`, `--glp-warning-bg` | hints; lines no example ran (coverage after Tests, and their marks in the editor) |
| `--glp-info`, `--glp-info-bg` | information that isn't a result: every line ran (coverage after Tests) - never green |
| `--glp-success` | passed tests, runtime ready |
| `--glp-syntax-keyword`, `-string`, `-number`, `-comment` | syntax colours (names, operators, brackets use `--glp-text`) |
| `--glp-font-code`, `--glp-font-ui`, `--glp-radius` | fonts and corner radius |

The embed is flat: no cards, its sections only separated by `--glp-border`
lines, so the host draws the one frame around it.

The Monaco editor uses the theme `glpython` (`src/monacoTheme.ts`), built from
the same tokens when the editor mounts (later changes to the variables need a
reload), and glpython's own Python language `glpython-python`
(`src/pythonLanguage.ts`): Monaco's Python definition, but only Python's
keywords as keywords (not builtins such as `print` or `type`), `True`,
`False` and `None` as values, and comments after code. The visualizer
highlights code with the same language.

## Development

```bash
npm install
npm run build   # tsc -b && vite build, emits dist/
npm run lint     # oxlint
```

`npm run dev` runs `vite build --watch` for iterating against a locally
linked copy (e.g. via `npm link` or a workspace/yalc setup) in a consuming
shell project.

The embed development and preview servers set
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. The production build also ships a
vendored `coi-serviceworker` fallback for static hosts that cannot configure
headers. It registers only when the embed runs as the top-level page, avoiding
reload loops in a cross-origin iframe.

Cross-origin isolation is controlled by the complete browsing context, not only
the iframe response. A glpython iframe inside a non-isolated course host cannot
use `SharedArrayBuffer`, even if the iframe itself ships the service worker.
The `glpython:ready` message therefore reports `capabilities.input`; hosts must
not assume synchronous `input()` support. Normal execution, visualization, and
turtle graphics do not require the synchronous input channel.

## Notes on the build

- The library builds to a single ESM bundle (`dist/index.js`) plus
  per-module `.d.ts` declaration files under `dist/src/`.
- The Pyodide worker (`src/pyodide-worker.js`) is loaded at runtime via
  `new Worker(new URL('./pyodide-worker.js', import.meta.url))`. Vite
  detects this pattern automatically and emits the worker as a
  content-hashed asset under `dist/assets/`, rewriting the reference to
  match — no manual copy step is needed for it.
- `src/style.css` is not imported by any module in the component tree (the
  original app only imported it from its own entry point, not from the
  component itself), so Vite's build never touches it. It's copied verbatim
  to `dist/style.css` by the `build` script and exposed via the
  `glpython-editor/style.css` export; consuming shells must import it
  explicitly.

## Lizenz / License

MIT – see [LICENSE](LICENSE). Third-party code it contains or bundles (Monaco
Editor's Python definition, coi-serviceworker, and the libraries bundled into
the embed) is listed with its notices in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
