"""Regression test: the file that runs is the module "__main__" (P37), as in
"python3 main.py": "import __main__; __main__.x" sees its variables, after a
Run, in the REPL after it and in the visualizer; "if __name__ == '__main__':"
runs; and a function of another file still reads the caller's variables with
"sys._getframe(1).f_globals", as the course does (after a Run and in the
REPL; in the visualizer that frame is the interpreter's), or through
"__main__". A visualizer run and a replay don't replace the REPL's own
"__main__".

Runs the runtime with CPython (no Pyodide needed):
    python3 -B scripts/check-runtime-main.py
"""
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = os.path.join(ROOT, "src", "runtime")
sys.path.insert(0, RUNTIME)  # for "import gturtle"

# Loaded as Pyodide loads them, so their frames are named "<exec>" there too.
runtime = {"__name__": "glpython_runtime"}
for name in ("hints.py", "session.py", "visualizer.py"):
    with open(os.path.join(RUNTIME, name), encoding="utf-8") as handle:
        exec(compile(handle.read(), "<exec>", "exec"), runtime)

failures = []


def expect(label, got, expected):
    if got != expected:
        failures.append(f"{label}: got {got!r}, expected {expected!r}")


MAIN = '''import sys
x = 2
import __main__
print(__main__.x)
print(__main__)
print(__main__ is sys.modules["__main__"], __name__)
if __name__ == "__main__":
    print("als Programm")
import hilfe
print(hilfe.lies("x"), hilfe.lies_main("x"))
'''
HILFE = '''import sys

def lies(name):
    return sys._getframe(1).f_globals[name]

def lies_main(name):
    import __main__
    return getattr(__main__, name)
'''
folder = os.path.realpath(tempfile.mkdtemp(prefix="glpython-main-"))
for path, source in (("main.py", MAIN), ("hilfe.py", HILFE)):
    with open(os.path.join(folder, path), "w", encoding="utf-8") as handle:
        handle.write(source)
main_path = os.path.join(folder, "main.py")

# A Run prints what CPython prints.
cpython = subprocess.run([sys.executable, "-B", "main.py"], cwd=folder, capture_output=True, text=True)
expected = cpython.stdout.replace(f"'{folder}/", "'/")
sys.path.insert(0, folder)
printed = io.StringIO()
with contextlib.redirect_stdout(printed):
    runtime["_glpython_run_project"](main_path)
expect("Run", printed.getvalue().replace(f"'{folder}/", "'/"), expected)
expect("Run, the whole output", expected, "2\n<module '__main__' from '/main.py'>\nTrue __main__\nals Programm\n2 2\n")


def repl(source):
    with contextlib.redirect_stdout(io.StringIO()):
        return json.loads(runtime["_glpython_repl"](source)).get("value")


# The REPL after the Run: the same module, in both directions.
expect("REPL: __main__.x", repl("__main__.x"), "2")
repl("y = 5")
expect("REPL: __main__.y", repl("__main__.y"), "5")
repl("__main__.z = 7")
expect("REPL: z", repl("z"), "7")
expect("REPL: _getframe from another file", repl('hilfe.lies("y")'), "5")
expect("REPL: __main__ from another file", repl('hilfe.lies_main("y")'), "5")
repl_main = sys.modules["__main__"]
expect("REPL: the namespace is the module's", repl_main.__dict__ is runtime["_glpython_repl_namespace"], True)

# The visualizer runs the file as "__main__" too (its __file__ is the
# editor's name), and gives the REPL's module back afterwards.
trace_source = MAIN.replace("print(__main__)\n", "").replace('hilfe.lies("x"), ', "")
result = json.loads(runtime["_glpython_trace_program"]("main.py", {"main.py": trace_source, "hilfe.py": HILFE}, None))
expect("visualizer", (result["output"], result["errorMessage"]), ("2\nTrue __main__\nals Programm\n2\n", None))
expect("visualizer: the REPL's __main__ is back", sys.modules["__main__"] is repl_main, True)

# A traced REPL input (a dry run) sees the file's variables through
# __main__, and changing them changes nothing in the session.
result = json.loads(runtime["_glpython_run_visual_repl"]("__main__.y = 99", json.dumps({"main.py": MAIN, "hilfe.py": HILFE}), "main.py"))
expect("visual REPL: no error", result["errorMessage"], None)
expect("visual REPL: a dry run", (repl("y"), sys.modules["__main__"] is repl_main), ("5", True))
result = json.loads(runtime["_glpython_run_visual_repl"]("print(__main__.y)", json.dumps({"main.py": MAIN, "hilfe.py": HILFE}), "main.py"))
expect("visual REPL: __main__.y", result["output"], "5\n")

# A replay runs the file and the inputs in a "__main__" of its own, then
# restores the session's.
runtime["_glpython_replay_begin"](json.dumps([main_path, os.path.join(folder, "hilfe.py")]))
with contextlib.redirect_stdout(io.StringIO()):
    runtime["_glpython_replay_file"](main_path)
    replayed = json.loads(runtime["_glpython_replay_input"]("__main__.x")).get("value")
expect("replay: __main__.x", replayed, "2")
expect("replay: a module of its own", sys.modules["__main__"] is not repl_main, True)
runtime["_glpython_replay_end"]()
expect("replay: the session's __main__ is back", sys.modules["__main__"] is repl_main, True)

# Before any Run, the REPL is "__main__", as Python's own.
fresh = {"__name__": "glpython_runtime"}
for name in ("hints.py", "session.py"):
    with open(os.path.join(RUNTIME, name), encoding="utf-8") as handle:
        exec(compile(handle.read(), "<exec>", "exec"), fresh)
with contextlib.redirect_stdout(io.StringIO()):
    fresh["_glpython_repl"]("a = 1")
    value = json.loads(fresh["_glpython_repl"]("import __main__; print(__main__.a)"))
expect("REPL before a Run", value.get("error"), None)

if failures:
    print("\n".join(failures))
    sys.exit(f"{len(failures)} __main__ check(s) failed.")
print("Runtime __main__ checks passed.")
