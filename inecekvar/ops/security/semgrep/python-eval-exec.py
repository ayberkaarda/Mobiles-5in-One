# Fixture for iv-python-eval-exec (semgrep --test).
import ast
import json


def positives(expression: str) -> None:
    # ruleid: iv-python-eval-exec
    eval(expression)
    # ruleid: iv-python-eval-exec
    exec(expression)


def negatives(expression: str, frame) -> None:
    # ok: iv-python-eval-exec
    ast.literal_eval(expression)
    # ok: iv-python-eval-exec
    json.loads(expression)
    # ok: iv-python-eval-exec
    frame.evaluate(expression)
