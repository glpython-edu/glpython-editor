"""Regression test: the Tests button's doctest runner (src/runtime/doctests.py)
- the summary, each failing example with doctest's own report and the texts it
compared, the print hint, and a file that doesn't load.

Runs the runtime with CPython (no Pyodide needed):
    python3 -B scripts/check-runtime-doctests.py
"""
import contextlib
import io
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = os.path.join(ROOT, "src", "runtime")

namespace = {"__name__": "glpython_runtime"}
for name in ("hints.py", "doctests.py"):
    with open(os.path.join(RUNTIME, name), encoding="utf-8") as handle:
        exec(compile(handle.read(), name, "exec"), namespace)
run_doctests = namespace["_glpython_run_doctests"]

failures = []
folder = tempfile.mkdtemp(prefix="glpython-doctests-")
sys.path.insert(0, folder)  # the worker mounts a project's files next to each other


def run(source, name="main.py"):
    """The report for one file, and what the run printed outside the examples."""
    path = os.path.join(folder, name)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(source)
    printed = io.StringIO()
    with contextlib.redirect_stdout(printed):
        report = json.loads(run_doctests(path))
    return report, printed.getvalue()


def expect(label, got, expected):
    if got != expected:
        failures.append(f"{label}: got {got!r}, expected {expected!r}")


PROGRAM = '''def doppelt(x):
    """
    >>> doppelt(2)
    4
    >>> doppelt(3)
    6
    """
    return x * x

def zeige(x):
    """
    >>> zeige(3)
    9
    """
    print(x * x)

def teile(a, b):
    """
    >>> teile(1, 0)
    0
    """
    return a / b

def länge(text):
    """
    >>> länge("ä🙂")
    2
    """
    return len(text)

if __name__ == "__main__":
    print("main läuft")
'''
report, printed = run(PROGRAM)
expect("attempted", report.get("attempted"), 5)
expect("failed", report.get("failed"), 2)
expect("main block", printed, "")
failed = report.get("failures", [])
expect("failing examples", [(f["name"], f["line"], f["source"]) for f in failed],
       [("main.doppelt", 5, "doppelt(3)"), ("main.teile", 19, "teile(1, 0)")])
if len(failed) == 2:
    # A wrong result: doctest's own words, and both texts for «Erhalten · Erwartet».
    expect("want", failed[0].get("want"), "6\n")
    expect("got", failed[0].get("got"), "9\n")
    for part in ("Failed example:", "doppelt(3)", "Expected:", "Got:"):
        if part not in failed[0]["text"]:
            failures.append(f"report of doppelt(3) lacks {part!r}: {failed[0]['text']!r}")
    # An exception: no texts to compare.
    expect("exception want/got", ("want" in failed[1], "got" in failed[1]), (False, False))
    for part in ("Exception raised:", "ZeroDivisionError"):
        if part not in failed[1]["text"]:
            failures.append(f"report of teile(1, 0) lacks {part!r}: {failed[1]['text']!r}")
# Passes in doctest, but printed instead of returning.
expect("print hints", report.get("printHints"), [{"source": "zeige(3)", "output": "9"}])
# The file's definitions stay available to visualize a failing example.
expect("test namespace", sorted(n for n in ("doppelt", "zeige", "teile", "länge") if n in namespace["_glpython_test_namespace"]),
       ["doppelt", "länge", "teile", "zeige"])
# doctest swaps sys.displayhook per example; the runner restores it.
expect("displayhook restored", sys.__displayhook__ is sys.displayhook, True)

# Importing another file of the project.
run("def halb(x):\n    return x / 2\n", "hilfe.py")
report, _ = run('''from hilfe import halb

def viertel(x):
    """
    >>> viertel(8)
    2.0
    """
    return halb(halb(x))
''')
expect("import: attempted/failed", (report.get("attempted"), report.get("failed")), (1, 0))

# Values, not their display: one literal on each side passes when the two
# values are equal with ==.
def example(source, want, body):
    return f'def f():\n    """\n    >>> {source}\n    {want}\n    """\n    {body}\n'


def outcome(label, source, want, body, passes):
    report, _ = run(example(source, want, body))
    expect(f"{label}: attempted/failed", (report.get("attempted"), report.get("failed")), (1, 0 if passes else 1))
    return report


outcome("4 for 4.0", "f()", "4", "return 8 / 2", True)
outcome("5.0 for 5", "f()", "5.0", "return 5", True)
outcome("list spacing", "f()", "[1,2,30]", "return [1, 2, 30]", True)
outcome("quote style", "f()", '"+"', 'return "+"', True)
outcome("nested lists with strings", "f()", '["+", 1, ["*", 2, 3]]', "return ['+', 1, ['*', 2, 3]]", True)
outcome("dict, tuple, set, None", "f()", "({'a':1}, (1,2), {3}, None)", "return ({'a': 1}, (1, 2), {3}, None)", True)
outcome("written over several lines", "f()", "[1,\n     2]", "return [1, 2]", False)
# True == 1 in Python; doctest itself already accepts True for 1.
outcome("True for 1", "f()", "1", "return True", True)
outcome("1 for True", "f()", "True", "return 1", True)
# No tolerance: 0.1 + 0.2 != 0.3.
outcome("float", "f()", "0.3", "return 0.1 + 0.2", False)
# A string is not its content: '4' is not 4.
outcome("string for number", "f()", "4", "return '4'", False)
# A wrong value: the report shows both texts as written.
report = outcome("wrong value", "f()", "[1,2,3]", "return [1, 2, 30]", False)
failed = report.get("failures", [{}])[0]
expect("wrong value: want/got", (failed.get("want"), failed.get("got")), ("[1,2,3]\n", "[1, 2, 30]\n"))
for part in ("Expected:\n    [1,2,3]\n", "Got:\n    [1, 2, 30]\n"):
    if part not in failed.get("text", ""):
        failures.append(f"wrong value: report lacks {part!r}: {failed.get('text')!r}")
# Expected exceptions work as before; an unexpected one still fails.
outcome("expected exception", "f()", "Traceback (most recent call last):\n    ...\n    ZeroDivisionError: division by zero", "return 1 / 0", True)
outcome("other exception", "f()", "Traceback (most recent call last):\n    ...\n    ValueError: x", "return 1 / 0", False)
# Several lines of output: compared as text.
outcome("several lines", "f()", "1\n    2", "print(1); print(2)", True)
outcome("several lines, other spacing", "f()", "[1,2]\n    3", "print([1, 2]); print(3)", False)
# What print wrote is compared as its text would be: one literal on a line
# counts as that value, so print(5) passes for 5.0 as return 5 does; the
# print hint stays.
report = outcome("print", "f()", "5.0", "print(5)", True)
expect("print: hint", report.get("printHints"), [{"source": "f()", "output": "5"}])
outcome("print text", "f()", "Hallo", "print('Hallo')", True)
outcome("print text, other", "f()", "hallo", "print('Hallo')", False)
# Not literals: compared as text.
outcome("function object", "f", "<function f at 0x0>", "return 1", False)
outcome("set()", "f()", "set()", "return set()", True)
outcome("set() for {}", "f()", "{}", "return set()", False)
# An example's own comparison flag: doctest's check alone.
outcome("NORMALIZE_WHITESPACE", "f()  # doctest: +NORMALIZE_WHITESPACE", "[1,2]", "return [1, 2]", False)
outcome("ELLIPSIS", "f()  # doctest: +ELLIPSIS", "[1, ...]", "return [1, 2]", True)
outcome("ELLIPSIS, no value comparison", "f()  # doctest: +ELLIPSIS", "4", "return 4.0", False)

# No examples at all.
report, _ = run("def f(x):\n    return x\n")
expect("no examples", (report.get("attempted"), report.get("failed"), report.get("failures"), report.get("printHints")), (0, 0, [], []))

# A file that doesn't load: Python's error (for a syntax error with the line
# and caret above it).
report, _ = run("def f(x)\n    return x\n")
expect("syntax error", str(report.get("error", "")).splitlines()[-1:], ["SyntaxError: expected ':'"])
report, _ = run("x = 1 / 0\n")
expect("error while loading", report.get("error"), "ZeroDivisionError: division by zero")

if failures:
    print("\n".join(failures))
    sys.exit(f"{len(failures)} doctest check(s) failed.")
print("Runtime doctest checks passed.")
