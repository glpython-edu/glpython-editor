"""Regression test (P62): a function the traced file didn't define - from a
library such as a course's parser.py, another project file or the standard
library - is shown as "function@<origin>#<name>", and the trace's "functions"
says what it does, not how: its signature, its docstring without the doctest
examples (their ">>>" lines, "..." continuations and expected output), and
where it comes from; never its body. The file's own functions stay
"function" (their full definition is the UI's to show), also in a REPL
input's trace.

Runs the runtime with CPython (no Pyodide needed):
    python3 -B scripts/check-runtime-functions.py
"""
import contextlib
import io
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = os.path.join(ROOT, "src", "runtime")
sys.path.insert(0, RUNTIME)  # for "import gturtle"

runtime = {"__name__": "glpython_runtime"}
for name in ("hints.py", "session.py", "visualizer.py"):
    with open(os.path.join(RUNTIME, name), encoding="utf-8") as handle:
        exec(compile(handle.read(), "<exec>", "exec"), runtime)

folder = tempfile.mkdtemp(prefix="glpython-functions-")
sys.path.insert(0, folder)
failures = []

LIBRARY = '''def parse(text):
    """Gibt den Ausdrucksbaum zum Ausdruck text zurück.

    >>> parse("1 + 2")
    ['+', 1, 2]
    >>> parse(
    ...     "2 * 3")
    ['*', 2, 3]

    Was kein Ausdruck ist, wird abgelehnt.
    """
    geheim = text.split()
    return [geheim[1], int(geheim[0]), int(geheim[2])]


def ist_liste(x):
    return isinstance(x, list)
'''
MAIN = '''from bibliothek import parse, ist_liste
from math import sqrt


def auswerten(baum):
    """Rechnet den Baum aus."""
    return baum


auswerten(parse("1 + 2"))
'''
for name, source in (("bibliothek.py", LIBRARY), ("main.py", MAIN)):
    with open(os.path.join(folder, name), "w", encoding="utf-8") as handle:
        handle.write(source)
main_path = os.path.join(folder, "main.py")[1:]
library_path = os.path.join(folder, "bibliothek.py")[1:]
sources = {main_path: MAIN, library_path: LIBRARY}


def captured(call, *args):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return call(*args)


def expect(label, got, want):
    if got != want:
        failures.append(f"{label}: got {got!r}, want {want!r}")


result = json.loads(captured(runtime["_glpython_trace_program"], main_path, sources, None))
expect("the file runs", result["error"], None)
module = [step["locals"] for step in result["trace"] if step["frameId"] == 0 and step["locals"]][-1]
parse_key, liste_key, sqrt_key = f"function@{library_path}#parse", f"function@{library_path}#ist_liste", "function@math#sqrt"
expect("the footer's entries", module, {"parse": parse_key, "ist_liste": liste_key, "sqrt": sqrt_key, "auswerten": "function"})
functions = result.get("functions", {})
expect("parse: signature, docstring without its examples, origin", functions.get(parse_key), {
    "name": "parse",
    "signature": "parse(text)",
    "doc": "Gibt den Ausdrucksbaum zum Ausdruck text zurück.\n\nWas kein Ausdruck ist, wird abgelehnt.",
    "origin": library_path,
})
expect("ist_liste: no docstring", functions.get(liste_key), {"name": "ist_liste", "signature": "ist_liste(x)", "doc": None, "origin": library_path})
expect("sqrt: from the standard library", functions.get(sqrt_key), {"name": "sqrt", "signature": "sqrt(x, /)", "doc": "Return the square root of x.", "origin": "math"})
if "geheim" in json.dumps(functions):
    failures.append("an imported function's body is in the trace")
expect("only the imported functions", sorted(functions), sorted([parse_key, liste_key, sqrt_key]))

# A REPL input against the last Run: the file's functions stay its own, the
# imported ones keep their origin - in the session's globals too (P61).
captured(runtime["_glpython_run_project"], os.path.join(folder, "main.py"))
result = json.loads(captured(runtime["_glpython_run_visual_repl"], 'auswerten(parse("2 + 3"))', json.dumps(sources), main_path))
expect("a REPL input: the session's globals", (result.get("globals") or {}).get("locals"), {"parse": parse_key, "ist_liste": liste_key, "sqrt": sqrt_key, "auswerten": "function"})
expect("a REPL input: the functions", sorted(result.get("functions", {})), sorted([parse_key, liste_key, sqrt_key]))

if failures:
    print("\n".join(failures))
    sys.exit(f"{len(failures)} function check(s) failed.")
print("Runtime function checks passed.")
