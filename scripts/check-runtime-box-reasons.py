"""Regression test: why a call stays a box in the substitution and tree modes
(P34). A call-enter step of a function without the short form names the
reason ("boxReason"), for the note at its box: local variables (or a loop),
an "if" choosing what runs, several statements, no "return <expression>", a
return expression that can't be written out with its values. A function with
the short form has none.

Runs the runtime with CPython (no Pyodide needed):
    python3 -B scripts/check-runtime-box-reasons.py
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

cases = [
    ("locals", "def f(noten):\n    summe = sum(noten)\n    return summe / len(noten)\n\nf([4, 5])\n", "locals"),
    ("a loop", "def f(n):\n    for i in range(n):\n        pass\n    return n\n\nf(2)\n", "locals"),
    ("an if", "def f(n):\n    if n == 0:\n        return 1\n    return n * f(n - 1)\n\nf(1)\n", "branches"),
    ("several statements", "def f(n):\n    print(n)\n    return n + 1\n\nf(1)\n", "statements"),
    ("no return", "def f(n):\n    print(n)\n\nf(1)\n", "no-return"),
    ("a bare return", "def f(n):\n    return\n\nf(1)\n", "no-return"),
    ("a comprehension", "def f(n):\n    return [i * i for i in range(n)]\n\nf(3)\n", "expression"),
    ("a docstring and if", 'def f(n):\n    """Doc."""\n    if n:\n        print(n)\n    return n\n\nf(1)\n', "branches"),
    ("a nested def", "def f(n):\n    def g():\n        x = 1\n        return x\n    return g()\n\nf(1)\n", "statements"),
]
for label, source, expected in cases:
    result = json.loads(runtime["_glpython_trace_program"]("main.py", {"main.py": source}, None))
    enter = next(step for step in result["trace"] if step["kind"] == "call-enter" and step["func"] == "f")
    if enter.get("boxReason") != expected or enter.get("shortForm") is not None:
        failures.append(f"{label}: boxReason {enter.get('boxReason')!r}, expected {expected!r}")

# The short form has no reason: it isn't a box there.
result = json.loads(runtime["_glpython_trace_program"]("main.py", {"main.py": 'def f(x):\n    """Doc."""\n    return x * x\n\nf(3)\n'}, None))
enter = next(step for step in result["trace"] if step["kind"] == "call-enter")
if enter.get("boxReason") is not None or enter.get("shortForm") is None:
    failures.append(f"short form: boxReason {enter.get('boxReason')!r}")

if failures:
    print("\n".join(failures))
    sys.exit(f"{len(failures)} box reason check(s) failed.")
print("Runtime box reason checks passed.")
