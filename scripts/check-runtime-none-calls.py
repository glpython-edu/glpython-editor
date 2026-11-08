"""Regression test (P49): a call that is a whole statement and returns None.
A call of the learner's own function shows its None as the last step - in a
program, a REPL input and a doctest example alike: a "def" of the file, of
another file of the project, a lambda, a method of their class, a function
from an earlier REPL input. A built-in, a method of a built-in type and a
function of a module glpython or Python brings along (gturtle, random)
keep their call text. A call whose value is used shows None as before.

Runs the runtime with CPython (no Pyodide needed):
    python3 -B scripts/check-runtime-none-calls.py
"""
import contextlib
import io
import json
import os
import sys
import types

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


def call_values(result, path, source):
    """(source text, shown value) of each call's last step in the file, in
    order; the value is None where the call keeps its text."""
    lines = source.split("\n")
    return [
        (lines[step["line"] - 1][step["col"]:step["endCol"]], step["valueText"])
        for step in result["trace"]
        if step["kind"] == "eval" and step["path"] == path and step["label"].endswith("(...)")
    ]


LIB = '''def melde(text):
    print(text)
'''

MAIN = '''import random
import gturtle
import lib


def anwenden(op, x, y):
    if op == '+':
        return x + y


class Zaehler:
    def erhoehe(self):
        self.n = 1


nichts = lambda: None
xs = []
anwenden('*', 3, 4)
lib.melde('hallo')
nichts()
Zaehler().erhoehe()
print('x')
xs.append(1)
random.shuffle(xs)
gturtle.forward(10)
ergebnis = anwenden('*', 3, 4)
f = anwenden
f('*', 1, 2)
'''
SOURCES = {"main.py": MAIN, "lib.py": LIB}

# The other file as the worker mounts it, at "/lib.py".
lib = types.ModuleType("lib")
lib.__file__ = "/lib.py"
exec(compile(LIB, "/lib.py", "exec"), lib.__dict__)
sys.modules["lib"] = lib

result = json.loads(runtime["_glpython_trace_program"]("main.py", SOURCES, None))
expect("program: no error", result["errorMessage"], None)
expect("program: the calls' values", [value for text, value in call_values(result, "main.py", MAIN) if text != "Zaehler()"], [
    "None",  # anwenden('*', 3, 4)
    "None",  # lib.melde('hallo'): a file of the project
    "None",  # nichts(): a lambda
    "None",  # Zaehler().erhoehe(): a method of the learner's class
    None,  # print('x')
    None,  # xs.append(1)
    None,  # random.shuffle(xs)
    None,  # gturtle.forward(10)
    "None",  # ergebnis = anwenden('*', 3, 4): the value is used
    "None",  # f('*', 1, 2): the learner's function under another name
])

# A REPL input (and a failing doctest example, which is traced the same way
# against the Tests run's namespace): the file's functions as a Run left them.
REPL_MAIN = '''def anwenden(op, x, y):
    """
    >>> anwenden('*', 3, 4)
    12
    """
    if op == '+':
        return x + y


def zeige(x):
    """
    >>> zeige(3)
    3
    """
    print(x)
'''
for namespace_name, namespace in (("repl", "_glpython_repl_namespace"), ("test", "_glpython_test_namespace")):
    values = runtime.setdefault(namespace, {})
    values.clear()
    values["__name__"] = "__main__"
    exec(compile(REPL_MAIN, "/main.py", "exec"), values)
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile("def leer():\n    pass\n", "<repl>", "exec"), values)
    for source, expected in (("anwenden('*', 3, 4)", "None"), ("zeige(3)", "None"), ("leer()", "None"), ("print(3)", None), ("anwenden('+', 3, 4)", "7")):
        traced = json.loads(runtime["_glpython_run_visual_repl"](source, json.dumps({"main.py": REPL_MAIN}), "main.py", namespace_name))
        calls = [value for text, value in call_values(traced, "<repl>", source) if text == source]
        expect(f"{namespace_name}: {source}", calls[-1:], [expected])

# The console shows nothing for None, as CPython's REPL.
runtime["_glpython_repl_namespace"].clear()
runtime["_glpython_repl_namespace"]["__name__"] = "__main__"
exec(compile(REPL_MAIN, "/main.py", "exec"), runtime["_glpython_repl_namespace"])
with contextlib.redirect_stdout(io.StringIO()) as printed:
    answer = json.loads(runtime["_glpython_repl"]("anwenden('*', 3, 4)"))
expect("console: anwenden('*', 3, 4)", (answer.get("value"), printed.getvalue()), (None, ""))

if failures:
    print("\n".join(failures))
    sys.exit(f"{len(failures)} None call check(s) failed.")
print("Runtime None call checks passed.")
