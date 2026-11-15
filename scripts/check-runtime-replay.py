"""Regression test: visualizing an earlier REPL input replays the session up
to it (session.py's _glpython_replay_*, driven by the worker's
replayReplEntry). After the file and the inputs before it, the replayed
namespace holds what the original session held at that point; the traced
input reports what it printed and evaluated to the first time; input() is
flagged instead of asked; and the live session (its namespace, the project's
modules, the turtle's drawing) stays untouched.

What the worker compares (output and values, addresses masked) is checked
here as the worker does it, on the texts session.py returns.

Runs the runtime with CPython (no Pyodide needed):
    python3 -B scripts/check-runtime-replay.py
"""
import contextlib
import io
import json
import os
import re
import sys
import tempfile
import types
import builtins

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME = os.path.join(ROOT, "src", "runtime")
sys.path.insert(0, RUNTIME)  # for "import gturtle"

# Loaded as Pyodide loads them, so their frames are named "<exec>" there too
# (tracebacks leave those out).
runtime = {"__name__": "glpython_runtime"}
for name in ("hints.py", "session.py", "visualizer.py"):
    with open(os.path.join(RUNTIME, name), encoding="utf-8") as handle:
        exec(compile(handle.read(), "<exec>", "exec"), runtime)

folder = tempfile.mkdtemp(prefix="glpython-replay-")
sys.path.insert(0, folder)  # the worker mounts a project's files next to each other
failures = []


def comparable(text):
    # As the worker's replayComparable.
    return re.sub(r" at 0x[0-9a-f]+>", " at 0x…>", text)


def state(namespace):
    """What a namespace holds, comparable across two sessions."""
    shown = {}
    for name, value in namespace.items():
        if name == "__builtins__":
            continue
        if isinstance(value, types.ModuleType):
            shown[name] = ("module", value.__name__, {key: repr(item) for key, item in vars(value).items() if not key.startswith("__") and not callable(item) and not isinstance(item, types.ModuleType)})
        elif isinstance(value, types.FunctionType):
            shown[name] = ("function", value.__code__.co_filename, value.__qualname__, value.__code__.co_firstlineno)
        else:
            shown[name] = comparable(repr(value))
    return shown


def captured(call, *args):
    printed = io.StringIO()
    with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
        result = call(*args)
    return result, printed.getvalue()


def session(files, inputs, label):
    """Runs the file and the inputs as the live session does, then replays up
    to each input and checks it against the original."""
    paths = {}
    for name, source in files.items():
        path = os.path.join(folder, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(source)
        paths[name] = path
    for module in [name for name, module in sys.modules.items() if getattr(module, "__file__", "") and os.path.dirname(module.__file__) == folder]:
        del sys.modules[module]
    main = paths.get("main.py")
    run_output = ""
    if not files:
        # A worker where nothing ran yet.
        runtime["_glpython_repl_namespace"] = runtime["_glpython_new_main"]()
    else:
        try:
            _, run_output = captured(runtime["_glpython_run_project"], main)
        except BaseException:
            run_output = runtime["_glpython_last_error_report"]["traceback"]
    log, states = [], [state(runtime["_glpython_repl_namespace"])]
    for source in inputs:
        result_json, output = captured(runtime["_glpython_repl"], source)
        log.append((source, output, result_json))
        states.append(state(runtime["_glpython_repl_namespace"]))
    live = runtime["_glpython_repl_namespace"]
    live_state = state(live)
    live_modules = {name: module for name, module in sys.modules.items() if name in ("gturtle", *[os.path.splitext(f)[0] for f in files])}
    import gturtle
    live_drawing = list(gturtle.commands)

    # The worker passes the files as "main.py" etc. and mounts them at "/";
    # here they live in `folder`, so the trace gets them under that path
    # (without the leading "/", which _glpython_fill_scope_from_repl adds).
    sources = {path[1:]: files[name] for name, path in paths.items()}
    project_paths = list(paths.values()) + [gturtle.__file__]
    for index, (source, output, result_json) in enumerate(log):
        runtime["_glpython_replay_begin"](json.dumps(project_paths))
        try:
            if files:
                traceback_text, replay_output = captured(runtime["_glpython_replay_file"], main)
                if comparable(replay_output + traceback_text) != comparable(run_output):
                    failures.append(f"{label}: the file replays to {replay_output + traceback_text!r}, ran to {run_output!r}")
            for earlier_source, earlier_output, earlier_json in log[:index]:
                replay_json, replay_output = captured(runtime["_glpython_replay_input"], earlier_source)
                if (comparable(replay_output), comparable(replay_json)) != (comparable(earlier_output), comparable(earlier_json)):
                    failures.append(f"{label}: {earlier_source!r} replays to {replay_output!r} {replay_json}, ran to {earlier_output!r} {earlier_json}")
            if state(runtime["_glpython_replay_namespace"]) != states[index]:
                failures.append(f"{label}: before {source!r} the replay holds {state(runtime['_glpython_replay_namespace'])}, the session held {states[index]}")
            expected = json.loads(result_json)
            if expected.get("unparsed"):
                continue  # the UI offers no visualization
            trace, _ = captured(runtime["_glpython_run_visual_repl"], source, json.dumps(sources), paths.get("main.py", "/")[1:], "replay")
            trace = json.loads(trace)
            if runtime["_glpython_replay_needed_input"]():
                failures.append(f"{label}: {source!r} needed input() in the replay")
            got = (trace["output"].rstrip("\n"), trace["errorMessage"], (trace["value"] or {}).get("value"))
            want = (output.rstrip("\n"), expected.get("error"), expected.get("value"))
            if tuple(comparable(part) if isinstance(part, str) else part for part in got) != tuple(comparable(part) if isinstance(part, str) else part for part in want):
                failures.append(f"{label}: tracing {source!r} gives {got}, the session gave {want}")
            # The footer starts with the session's globals at that moment (P61):
            # the file's names and what the earlier inputs assigned.
            shown = set((trace.get("globals") or {}).get("locals", {}))
            held = {name for name in states[index] if not name.startswith("_glpython") and not (name.startswith("__") and name.endswith("__"))}
            if shown != held:
                failures.append(f"{label}: tracing {source!r} starts with the globals {sorted(shown)}, the session held {sorted(held)}")
            # A function of the file is traced step by step, not called opaquely.
            if files and any(step["kind"] == "call-enter" for step in trace["trace"]) != ("(" in source and any(f"def {name}" in files["main.py"] for name in re.findall(r"(\w+)\(", source))):
                failures.append(f"{label}: tracing {source!r} doesn't open the call boxes it should")
        finally:
            runtime["_glpython_replay_end"]()
    if runtime["_glpython_repl_namespace"] is not live or state(live) != live_state:
        failures.append(f"{label}: replaying changed the live namespace")
    for name, module in live_modules.items():
        if sys.modules.get(name) is not module:
            failures.append(f"{label}: replaying replaced the live module {name}")
    if list(sys.modules["gturtle"].commands) != live_drawing:
        failures.append(f"{label}: replaying changed the live drawing")
    return log


MAIN = '''
def quadrat(x):
    return x * x

def summe(zahlen):
    total = 0
    for zahl in zahlen:
        total = total + zahl
    return total

werte = [1, 2]
print("geladen")
'''

session({"main.py": MAIN}, [
    "quadrat(3)",
    "werte.append(quadrat(4))",
    "werte",
    "a = summe(werte)",
    "print(a, quadrat(a))",
    "summe(werte) + a",
    "quadrat('x')",          # an error, visualized up to it
    "werte = werte + [a]",
    "summe(werte)",
    "quadrat",               # the function itself
    "def neu(): return 1",   # a definition (flagged as belonging in the file)
    "neu()",
    "1 +",                   # doesn't parse
    "return 5",              # doesn't compile
    "werte",
], "main.py")

session({"main.py": "import helfer\n\ndef weiter():\n    return helfer.zaehle()\n", "helfer.py": "stand = 0\n\ndef zaehle():\n    global stand\n    stand = stand + 1\n    return stand\n"}, [
    "weiter()",
    "weiter()",
    "helfer.stand",
    "weiter() + weiter()",
], "an imported module's state")

session({"main.py": "from gturtle import *\nmakeTurtle()\nforward(50)\n\ndef seite(n):\n    forward(n)\n    return n\n"}, [
    "seite(30)",
    "right(90)",
    "seite(10)",
], "turtle")

session({"main.py": "zahl = int('x')\n\ndef nie():\n    return 1\n"}, [
    "nie",
    "zahl",
], "a Run that failed")

session({}, ["x = 2", "x * 3", "y = [x]", "y"], "no Run")

session({"main.py": "class Punkt:\n    pass\n\np = Punkt()\nprint(p)\n"}, ["p", "q = Punkt()", "q"], "default reprs")


# P61: the Etappe 4 scaffold's shape - a library imported by name, the file's
# functions, an earlier input's variable - and an input that assigns: its new
# name appears in a module step, next to the session's.
def traced_globals(files, inputs):
    session(files, inputs, "P61 globals")
    main = os.path.join(folder, "main.py")
    sources = {os.path.join(folder, name)[1:]: source for name, source in files.items()}
    runtime["_glpython_replay_begin"](json.dumps([os.path.join(folder, name) for name in files]))
    try:
        captured(runtime["_glpython_replay_file"], main)
        for source in inputs[:-1]:
            captured(runtime["_glpython_replay_input"], source)
        trace, _ = captured(runtime["_glpython_run_visual_repl"], inputs[-1], json.dumps(sources), main[1:], "replay")
    finally:
        runtime["_glpython_replay_end"]()
    return json.loads(trace)

SCAFFOLD = {
    "main.py": "from parser import parse, ist_liste\n\ndef auswerten(baum):\n    return baum\n\ndef berechnen(text):\n    return auswerten(parse(text))\n",
    "parser.py": "def parse(text):\n    return int(text)\n\ndef ist_liste(wert):\n    return isinstance(wert, list)\n",
}
trace = traced_globals(SCAFFOLD, ['berechnen("2")'])
if list((trace.get("globals") or {}).get("locals", {})) != ["parse", "ist_liste", "auswerten", "berechnen"]:
    failures.append(f"P61: the scaffold's globals before the first step: {trace.get('globals')}")
if any(step["frameId"] == 0 and step["locals"] for step in trace["trace"]):
    failures.append("P61: an input that assigns nothing records no globals of its own")
trace = traced_globals(SCAFFOLD, ["x = 3", 'berechnen("2")'])
if "x" not in (trace.get("globals") or {}).get("locals", {}):
    failures.append(f"P61: an earlier input's x is missing: {trace.get('globals')}")
trace = traced_globals(SCAFFOLD, ['ergebnis = berechnen("2")'])
if "ergebnis" in (trace.get("globals") or {}).get("locals", {}):
    failures.append("P61: the input's own name is there before it ran")
module_steps = [step["locals"] for step in trace["trace"] if step["frameId"] == 0 and step["locals"]]
if not module_steps or list(module_steps[-1]) != ["parse", "ist_liste", "auswerten", "berechnen", "ergebnis"]:
    failures.append(f"P61: the input's new name doesn't appear next to the session's: {module_steps}")
# A long value: its full text comes with the globals, not with step 1.
trace = traced_globals({"main.py": "zahlen = list(range(100))\n"}, ["1 + 2"])
globals_ = trace.get("globals") or {}
if not globals_.get("fullValues") or any(step.get("fullValues") for step in trace["trace"][:1]):
    failures.append(f"P61: the full value of a long global: {globals_}, step 1 {trace['trace'][:1]}")


# input() is flagged instead of asked, in the file, in an earlier input and in
# the traced input itself; afterwards input() is the bridge again.
def replay_needs_input(files, inputs):
    with open(os.path.join(folder, "main.py"), "w", encoding="utf-8") as handle:
        handle.write(files)
    runtime["_glpython_replay_begin"](json.dumps([os.path.join(folder, "main.py")]))
    try:
        captured(runtime["_glpython_replay_file"], os.path.join(folder, "main.py"))
        for source in inputs[:-1]:
            captured(runtime["_glpython_replay_input"], source)
        captured(runtime["_glpython_run_visual_repl"], inputs[-1], "{}", "main.py", "replay")
        return runtime["_glpython_replay_needed_input"]()
    finally:
        runtime["_glpython_replay_end"]()

import builtins
bridge = builtins.input
for files, inputs, needed in [
    ("name = input('Name? ')\n", ["1"], True),
    ("x = 1\n", ["y = input()", "x"], True),
    ("x = 1\n", ["x", "input('?')"], True),
    ("def frage():\n    try:\n        return input()\n    except Exception:\n        return '-'\n", ["frage()"], True),
    ("x = 1\n", ["x", "x + 1"], False),
]:
    if replay_needs_input(files, inputs) != needed:
        failures.append(f"input(): {files!r} {inputs} should{'' if needed else ' not'} be flagged")
    if builtins.input is not bridge:
        failures.append("input(): the replay didn't put input() back")


# Random numbers don't replay: the worker sees the difference and shows its
# note instead of a visualization of other numbers.
with open(os.path.join(folder, "main.py"), "w", encoding="utf-8") as handle:
    handle.write("import random\nzahl = random.randint(1, 10**9)\n")
captured(runtime["_glpython_run_project"], os.path.join(folder, "main.py"))
original, _ = captured(runtime["_glpython_repl"], "zahl")
runtime["_glpython_replay_begin"](json.dumps([os.path.join(folder, "main.py")]))
try:
    captured(runtime["_glpython_replay_file"], os.path.join(folder, "main.py"))
    replayed, _ = captured(runtime["_glpython_replay_input"], "zahl")
finally:
    runtime["_glpython_replay_end"]()
if comparable(original) == comparable(replayed):
    failures.append("random: the replay reproduced a random number, so the check can't see a difference")

if failures:
    print("\n".join(failures))
    sys.exit(f"{len(failures)} replay check(s) failed.")
print("Runtime replay checks passed.")
