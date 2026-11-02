"""Regression test: input() (src/runtime/input_bridge.py) - the console asks,
and the prompt with the answer stays in the output as one line, as in a
terminal; a cancelled wait (Stop) raises EOFError as Python does; where the
page can't wait, a RuntimeError with its hint. Also a learner's recursive
REPL called from the REPL, and the visualizer's one step for input(...).
The page's side (the worker's shared memory) is replaced by a stub.

Runs the runtime with CPython (no Pyodide needed):
    python3 -B scripts/check-runtime-input.py
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = os.path.join(ROOT, "src", "runtime")
sys.path.insert(0, RUNTIME)  # for "import gturtle"

# The page: answers in order, then the worker's markers for a cancelled wait
# or a page that can't wait.
answers = []
prompts = []


def request_input(prompt):
    prompts.append(prompt)
    answer = answers.pop(0)
    if answer in ("__GLPYTHON_INPUT_CANCELLED__", "__GLPYTHON_INPUT_UNAVAILABLE__"):
        raise Exception(answer)
    return answer


sys.modules["js"] = types.SimpleNamespace(requestInputFromMainThread=request_input)
namespace = {"__name__": "glpython_runtime"}
for name in ("input_bridge.py", "hints.py", "session.py", "visualizer.py", "doctests.py"):
    with open(os.path.join(RUNTIME, name), encoding="utf-8") as handle:
        exec(compile(handle.read(), name, "exec"), namespace)

failures = []
folder = tempfile.mkdtemp(prefix="glpython-input-")


def expect(label, got, expected):
    if got != expected:
        failures.append(f"{label}: got {got!r}, expected {expected!r}")


def run(source, given):
    """A Run with these answers: its output, Python's message, the hint."""
    answers[:] = given
    prompts.clear()
    path = os.path.join(folder, "main.py")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(source)
    printed = io.StringIO()
    message = None
    with contextlib.redirect_stdout(printed):
        try:
            namespace["_glpython_run_project"](path)
        except BaseException as error:
            message = namespace["_glpython_error_message"](error)
    report = json.loads(namespace["_glpython_take_error_report"]() or "null")
    return printed.getvalue(), message, report["errorHint"] if report else None


def repl(source, given):
    answers[:] = given
    printed = io.StringIO()
    with contextlib.redirect_stdout(printed):
        result = json.loads(namespace["_glpython_repl"](source))
    return printed.getvalue(), result


# The prompt and the answer as one line; the program's output follows.
output, message, _ = run('name = input("Name: ")\nprint("Hallo", name)\n', ["Zoë"])
expect("one input", (output, message, prompts), ("Name: Zoë\nHallo Zoë\n", None, ["Name: "]))
output, _, _ = run('x = input()\nprint(len(x))\n', [""])
expect("no prompt, empty answer", output, "\n0\n")
# print(..., end="") before input(): on one line, as in a terminal.
output, _, _ = run('print("Zahl", end=": ")\nx = input()\nprint(x)\n', ["4"])
expect("output before the prompt", output, "Zahl: 4\n4\n")

# A learner's REPL of their own language: recursive, called in the REPL
# after the Run.
LANGUAGE = '''def berechnen(text):
    return eval(text)

def repl():
    text = input("> ")
    if text == "ende":
        return
    print(berechnen(text))
    repl()
'''
output, message, _ = run(LANGUAGE, [])
expect("language: run", (output, message), ("", None))
output, result = repl("repl()", ["1 + 2", "2 * (3 + 4)", "ende"])
expect("language: transcript", output, "> 1 + 2\n3\n> 2 * (3 + 4)\n14\n> ende\n")
expect("language: no value, no error", (result.get("value"), result.get("error")), (None, None))
# 200 inputs deep: the recursion keeps working.
output, result = repl("repl()", [str(n) for n in range(200)] + ["ende"])
expect("language: 200 inputs", (output.count("\n"), result.get("error")), (401, None))

# Stop while input() waits: EOFError as in Python, after the prompt's line.
output, message, hint = run('x = input("> ")\nprint(x)\n', ["__GLPYTHON_INPUT_CANCELLED__"])
expect("cancelled", (output.split("Traceback")[0], message, hint), ("> \n", "EOFError: EOF when reading a line", None))
run(LANGUAGE, [])
output, result = repl("repl()", ["1 + 1", "__GLPYTHON_INPUT_CANCELLED__"])
expect("cancelled in the REPL", (output.startswith("> 1 + 1\n2\n> \n"), result.get("error", "").splitlines()[-1:]), (True, ["EOFError: EOF when reading a line"]))
# A program can catch it, as in Python.
output, message, _ = run('try:\n    input("> ")\nexcept EOFError:\n    print("Ende")\n', ["__GLPYTHON_INPUT_CANCELLED__"])
expect("EOFError caught", (output, message), ("> \nEnde\n", None))

# Where the page can't wait: a RuntimeError and its hint.
output, message, hint = run('x = input("> ")\n', ["__GLPYTHON_INPUT_UNAVAILABLE__"])
expect("unavailable", (message, hint), ("RuntimeError: input() is not available here", {"kind": "input-unavailable"}))

# The visualizer asks while it records: input(...) is one step, its value
# the answer, and the output has the prompt line.
answers[:] = ["2 * 3"]
result = json.loads(namespace["_glpython_trace_program"]("main.py", {"main.py": 'text = input("> ")\nprint(eval(text))\n'}, None))
steps = [(step["label"], step["valueText"]) for step in result["trace"] if step["label"].startswith("input(")]
expect("visualizer: input step", steps, [("input(...)", "'2 * 3'")])
expect("visualizer: output", (result["output"], result["error"]), ("> 2 * 3\n6\n", None))

# Behaves as Python's own input() otherwise.
expect("name", (namespace["_glpython_input"].__name__, __import__("builtins").input.__name__), ("input", "input"))

if failures:
    print("\n".join(failures))
    sys.exit(f"{len(failures)} input check(s) failed.")
print("Runtime input checks passed.")
