import builtins
from js import requestInputFromMainThread

# input() asks in the console: the page shows the prompt with an input line,
# and the answer comes back here. Then the prompt and the answer are printed
# as one line, as a terminal shows them ("> 2 * 3"). Cancelling (Stop) ends
# the wait with EOFError, as Ctrl+D does in Python. Where the page can't
# wait for an answer (no shared memory, e.g. in an embed that isn't
# cross-origin isolated), input() raises RuntimeError (hints.py words it).
def _glpython_input(prompt=""):
  prompt = str(prompt)
  try:
    answer = requestInputFromMainThread(prompt)
  except Exception as error:
    if "__GLPYTHON_INPUT_CANCELLED__" in str(error):
      print(prompt)
      raise EOFError("EOF when reading a line") from None
    if "__GLPYTHON_INPUT_UNAVAILABLE__" in str(error):
      raise RuntimeError("input() is not available here") from None
    raise
  print(prompt + answer)
  return answer

# As Python's own, e.g. in the visualizer's step "input(...)".
_glpython_input.__name__ = _glpython_input.__qualname__ = "input"
builtins.input = _glpython_input
