"""Regression test: lists that read as a tree (P34, "listtree"). A non-empty
list whose first element is a string is a node labelled with that string;
its other elements are subtrees where they read as a tree too, else leaves
(their repr). The REPL's value and the visualizer's variables carry the tree
for the UI to draw; too big a tree, one that contains itself and any other
value carry none.

Runs the runtime with CPython (no Pyodide needed):
    python3 -B scripts/check-runtime-trees.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = os.path.join(ROOT, "src", "runtime")
sys.path.insert(0, RUNTIME)  # for "import gturtle"

runtime = {"__name__": "glpython_runtime"}
for name in ("hints.py", "session.py", "visualizer.py"):
    with open(os.path.join(RUNTIME, name), encoding="utf-8") as handle:
        exec(compile(handle.read(), "<exec>", "exec"), runtime)

failures = []


def expect(label, got, expected):
    if got != expected:
        failures.append(f"{label}: got {got!r}, expected {expected!r}")


tree_of = runtime["_glpython_tree_of"]


def node(label, *children):
    return {"label": label, "children": list(children)}


def leaf(text):
    return {"leaf": text}


# The rule, generic: the course's trees and anything else of that shape.
for value, expected in [
    (["+", 2, ["*", 3, 4]], node("+", leaf("2"), node("*", leaf("3"), leaf("4")))),
    (["+", ["var", "x"], ["f", 1, 2]], node("+", node("var", leaf("'x'")), node("f", leaf("1"), leaf("2")))),
    (["+", "a", "b"], node("+", leaf("'a'"), leaf("'b'"))),
    (["-", ["+", 1, 2]], node("-", node("+", leaf("1"), leaf("2")))),
    (["liste", 1, 2], node("liste", leaf("1"), leaf("2"))),
    (["f"], node("f")),
    (["Anna", "Ben"], node("Anna", leaf("'Ben'"))),
    # Children that don't read as a tree are leaves, whatever they are.
    (["f", [1, 2], [], True, None, -2.5, ("a", 1), {"k": 1}], node("f", leaf("[1, 2]"), leaf("[]"), leaf("True"), leaf("None"), leaf("-2.5"), leaf("('a', 1)"), leaf("{'k': 1}"))),
    (["+", [3, "x"]], node("+", leaf("[3, 'x']"))),
    # Long texts shortened in their middle.
    (["a" * 30, "b" * 30], node("a" * 17 + "…" + "a" * 6, leaf("'" + "b" * 16 + "…" + "b" * 5 + "'"))),
]:
    expect(f"tree of {value!r:.40}", tree_of(value), expected)

# Not a tree: other values, and trees too big or containing themselves.
looped = ["f", 1]
looped.append(looped)
deep = ["x"]
for _ in range(12):
    deep = ["x", deep]
for value in ([], [1, "+", 2], ("+", 1, 2), "+", 3, None, {"+": 1}, ["+"] + [["n", i] for i in range(60)], looped, deep):
    expect(f"no tree: {value!r:.40}", tree_of(value), None)
expect("a tree just within the limits", tree_of(["+"] + [["n", i] for i in range(49)]) is not None, True)

# The REPL's value carries its tree.
expect("REPL: a tree", runtime["_glpython_repl_value"](["+", 2, 3]), {"value": "['+', 2, 3]", "tree": node("+", leaf("2"), leaf("3"))})
expect("REPL: no tree", runtime["_glpython_repl_value"]([1, 2]), {"value": "[1, 2]"})

# The visualizer: a step's variables name their trees, each stored once.
result = json.loads(runtime["_glpython_trace_program"]("main.py", {"main.py": 'baum = ["+", 2, ["*", 3, 4]]\nkopie = baum\nzahlen = [1, 2]\n'}, None))
text = "['+', 2, ['*', 3, 4]]"
expect("visualizer: the trees", result["trees"], [node("+", leaf("2"), node("*", leaf("3"), leaf("4")))])
last = result["trace"][-1]
expect("visualizer: the last step", (last["locals"]["baum"], last.get("trees")), (text, {text: 0}))
expect("visualizer: no full value for it", result["values"], [])
result = json.loads(runtime["_glpython_trace_program"]("main.py", {"main.py": "zahlen = [1, 2]\nnamen = ('a', 'b')\n"}, None))
expect("visualizer: no trees", (result["trees"], [step.get("trees") for step in result["trace"] if step.get("trees")]), ([], []))

if failures:
    print("\n".join(failures))
    sys.exit(f"{len(failures)} tree check(s) failed.")
print("Runtime tree checks passed.")
