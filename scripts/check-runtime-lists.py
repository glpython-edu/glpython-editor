"""Regression test: lists in the visualizer (P39, P40). Indexing a named list is
one step to the element ("dauer[1]" -> "2", not first "[1, 2, 30][1]"), as
the course writes chains on paper; a named list passed to a call is still
replaced by its value, and a list literal indexed directly is one step.
A display ("[1, 2]", "(a, b)", "{x}", "{k: v}") has no step of its own: of
literals (negative numbers too) it has none at all, otherwise only its parts
that change have one.
A long value is abbreviated ("[1, 2, 3, 4, 5, …, 100]"), the same in the
step and in the variables panel, with its full value in the trace's
"values"; short values and the course's expression trees stay complete.

Runs the visualizer runtime with CPython (no Pyodide needed):
    python3 -B scripts/check-runtime-lists.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = os.path.join(ROOT, "src", "runtime")
sys.path.insert(0, RUNTIME)  # for "import gturtle"

namespace = {"__name__": "glpython_runtime"}
for name in ("hints.py", "session.py", "visualizer.py"):
    with open(os.path.join(RUNTIME, name), encoding="utf-8") as handle:
        exec(compile(handle.read(), name, "exec"), namespace)

failures = []


def expect(label, got, expected):
    if got != expected:
        failures.append(f"{label}: got {got!r}, expected {expected!r}")


def trace(source):
    return json.loads(namespace["_glpython_trace_program"]("main.py", {"main.py": source}, None))


def evals_on_line(result, line):
    return [(step["label"], step["valueText"]) for step in result["trace"] if step["kind"] == "eval" and step["line"] == line]


# One step to the element; the list stays in the variables panel.
result = trace("dauer = [1, 2, 30]\nx = dauer[1]\ny = dauer[0] + dauer[1]\nz = [1, 2, 30][1]\n")
expect("dauer[1]", evals_on_line(result, 2), [("dauer[1]", "2")])
expect("dauer[0] + dauer[1]", evals_on_line(result, 3), [("dauer[0]", "1"), ("dauer[1]", "2"), ("1 + 2", "3")])
expect("the list in the panel", result["trace"][-1]["locals"]["dauer"], "[1, 2, 30]")
# A literal list indexed directly: one step to the element.
expect("[1, 2, 30][1]", evals_on_line(result, 4), [("[1, 2, 30][1]", "2")])

# The same for a tuple, a string, a dict, a slice, an index that is a
# variable (its value is shown) and a list in a list.
result = trace('t = (4, 5)\nw = "Hallo"\nd = {"a": 1}\nm = [[1, 2], [3, 4]]\ni = 1\nx = t[0] + len(w[1:3]) + d["a"] + m[i][0]\n')
labels = [label for label, _ in evals_on_line(result, 6)]
for unwanted in ("t", "w", "d", "m"):
    expect(f"no step of its own for {unwanted}", unwanted in labels, False)
expect("m[i][0]", [step for step in evals_on_line(result, 6) if step[0] in ("i", "m[1]", "[3, 4][0]")], [("i", "1"), ("m[1]", "[3, 4]"), ("[3, 4][0]", "3")])

# A named list passed to a call is replaced by its value, as before.
NOTEN = '''def notenschnitt(noten):
    return sum(noten) / len(noten)

noten = [5, 4.5, 6]
schnitt = notenschnitt(noten)
'''
result = trace(NOTEN)
expect("notenschnitt(noten)", evals_on_line(result, 5), [("noten", "[5, 4.5, 6]"), ("notenschnitt(...)", "5.166666666666667")])
enter = next(step for step in result["trace"] if step["kind"] == "call-enter")
expect("its short form fills in the list", [text for _, text in enter["shortForm"]["paramValues"]], ["[5, 4.5, 6]", "[5, 4.5, 6]"])

# An index that doesn't exist: the error step, with Python's message.
result = trace("dauer = [1, 2, 30]\nx = dauer[3]\n")
last = result["trace"][-1]
expect("dauer[3]", (last["kind"], last["line"], last["label"], result["errorMessage"]), ("error", 2, "IndexError: list index out of range", "IndexError: list index out of range"))
expect("dauer[3]: no step for the name", evals_on_line(result, 2), [])

# The chain's reason comment keeps an indexed name, as the step does.
result = trace("dauer = [1, 2, 30]\nif dauer[0] > 0:\n    pass\n")
expect("condition text", [step.get("conditionText") for step in result["trace"] if step["kind"] == "branch"], ["dauer[0] > 0"])

# A long list: abbreviated in the step and in the panel, its full value on
# request.
result = trace("l = list(range(1, 101))\n")
short = "[1, 2, 3, 4, 5, …, 100]"
step = next(step for step in result["trace"] if step["label"] == "list(...)")
expect("long list: the step", step["valueText"], short)
expect("long list: the panel", result["trace"][-1]["locals"]["l"], short)
full = result["values"][result["trace"][-1]["fullValues"][short]]
expect("long list: the full value", full, {"text": repr(list(range(1, 101))), "cut": False, "length": 100, "kind": "list"})
expect("long list: the step has it too", step["fullValues"][short], result["trace"][-1]["fullValues"][short])

# Short values and the course's expression trees stay complete; nothing is
# noted for them.
repr_of = namespace["_glpython_safe_repr"]
for value in (list(range(10)), ["+", 1, ["*", 2, 3]], ["+", ["*", 2, ["-", 7, 3]], ["/", ["+", 1, 2], 3]], ("a", "b"), {"x": 1, "y": [1, 2]}, "Hallo Welt", [None, True, 2.5]):
    expect(f"complete: {value!r}", repr_of(value), repr(value))
result = trace('baum = ["+", ["*", 2, ["-", 7, 3]], ["/", ["+", 1, 2], 3]]\n')
expect("expression tree: no full value", (result["values"], result["trace"][-1]["locals"]["baum"]), ([], "['+', ['*', 2, ['-', 7, 3]], ['/', ['+', 1, 2], 3]]"))

# A display of literals is a value: no steps but the assignment, nested at
# any depth, negative numbers included (P40).
def steps_on_line(result, line):
    return [(step["kind"], step["label"], step.get("valueText")) for step in result["trace"] if step["line"] == line]

LITERALS = [
    'baum = ["+", ["*", 2, ["-", 7, 3]], ["/", ["+", 1, 2], 3]]',
    'baum = ["-", 7, -3]',
    'baum = [-1, 2]',
    'baum = (-2.5, ("a", -1j), {"k": [-1, {2, -3}]}, {-4})',
    'baum = -3',
]
for line in LITERALS:
    result = trace(line + "\n")
    expect(f"no steps: {line}", [kind for kind, _, _ in steps_on_line(result, 1)], ["exec"])
    expect(f"its value: {line}", result["trace"][-1]["locals"]["baum"], repr(eval(line.split(" = ", 1)[1])))

# Names, calls and operators keep their steps; the display builds none.
for setup, line, expected, value in [
    ("", "w = [1 + 2, 3, 4]", [("1 + 2", "3")], "[3, 3, 4]"),
    ("a = 5", "w = [a, 2]", [("a", "5")], "[5, 2]"),
    ("x = 7", "w = [[1, 2], x]", [("x", "7")], "[[1, 2], 7]"),
    ("n = 2", 'w = ["+", 1, ["*", n, 3]]', [("n", "2")], "['+', 1, ['*', 2, 3]]"),
    ("n = 2", "w = (n, -n, {n: [n]})", [("n", "2"), ("n", "2"), ("n", "2"), ("n", "2")], "(2, -2, {2: [2]})"),
    ("", "w = [len([1, 2]), 3]", [("len(...)", "2")], "[2, 3]"),
]:
    result = trace(f"{setup}\n{line}\n")
    expect(f"one step each: {line}", evals_on_line(result, 2), expected)
    expect(f"the assignment: {line}", [label for kind, label, _ in steps_on_line(result, 2) if kind == "exec"], [f"w = {value}"])

# "-x" is one step, to x's value, where that already reads as the result;
# where it doesn't ("--7", "-True", "-(a + b)"), the minus has its step.
for setup, line, expected in [
    ("x = 7", "w = -x", [("x", "7")]),
    ("x = 2.5", "w = -x", [("x", "2.5")]),
    ("x = -7", "w = -x", [("x", "-7"), ("--7", "7")]),
    ("x = True", "w = -x", [("x", "True"), ("-True", "-1")]),
    ("a = 1\nb = 2", "w = -(a + b)", [("a", "1"), ("b", "2"), ("1 + 2", "3"), ("-3", "-3")]),
]:
    result = trace(f"{setup}\n{line}\n")
    row = setup.count("\n") + 2
    expect(f"unary: {setup}; {line}", evals_on_line(result, row), expected)

# Where the value reads differently from the display, the display has its
# step: unpacking, and duplicates in a set or dict. Unpacking as in Python.
for setup, line, expected in [
    ("b = [1]", "w = [*b, 2]", [("b", "[1]"), ("[*b, 2]", "[1, 2]")]),
    ("b = [1]", "w = (*b, 2)", [("b", "[1]"), ("(*b, 2)", "(1, 2)")]),
    ("b = [1]", "w = {*b, 2}", [("b", "[1]"), ("{*b, 2}", "{1, 2}")]),
    ('d = {"k": 1}', 'w = {**d, "j": 2}', [("d", "{'k': 1}"), ('{**d, "j": 2}', "{'k': 1, 'j': 2}")]),
    ("", "w = {1, 1}", [("{1, 1}", "{1}")]),
    ("", 'w = {"a": 1, "a": 2}', [('{"a": 1, "a": 2}', "{'a': 2}")]),
]:
    result = trace(f"{setup}\n{line}\n")
    expect(f"display step: {line}", evals_on_line(result, 2), expected)
    namespace_python = {}
    exec(f"{setup}\n{line}\n", namespace_python)
    expect(f"value: {line}", result["trace"][-1]["locals"]["w"], repr(namespace_python["w"]))

# How other long values are abbreviated: dicts, sets and tuples as lists,
# a list in a list, long strings in their middle, recursion as Python shows it.
for value, expected in [
    (list(range(11)), "[0, 1, 2, 3, 4, …, 10]"),
    (tuple(range(20)), "(0, 1, 2, 3, 4, …, 19)"),
    ({i: i * i for i in range(12)}, "{0: 0, 1: 1, 2: 4, 3: 9, 4: 16, …, 11: 121}"),
    (set(range(12)), "{0, 1, 2, 3, 4, …, 11}"),
    ([list(range(12)), [1]], "[[0, 1, 2, 3, 4, …, 11], [1]]"),
    ("x" * 100, "'" + "x" * 58 + "…" + "x" * 19 + "'"),
    # Still too long with 5 elements: 3, and long numbers shortened.
    ([10 ** 30] * 12, "[10000000000…0000, 10000000000…0000, 10000000000…0000, …, 10000000000…0000]"),
]:
    expect(f"abbreviated: {value!r:.40}", repr_of(value), expected)
recursive = [1]
recursive.append(recursive)
expect("recursive list", repr_of(recursive), "[1, [...]]")
# A string's length is in characters, a dict's in entries.
result = trace('s = "a" * 100\nd = {i: i for i in range(20)}\n')
expect("lengths", sorted((value["kind"], value["length"]) for value in result["values"]), [("dict", 20), ("str", 100)])

# A long value shows with the same abbreviation wherever it appears; each full
# text is stored once.
result = trace("l = list(range(1, 101))\nm = l\nn = len(l)\n")
expect("stored once", len(result["values"]), 1)

if failures:
    print("\n".join(failures))
    sys.exit(f"{len(failures)} list check(s) failed.")
print("Runtime list checks passed.")
