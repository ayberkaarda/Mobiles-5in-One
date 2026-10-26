#!/usr/bin/env python3
"""Gate for `dotnet list package --vulnerable --include-transitive --format json --output-version 1`.

Usage: check-vulnerable-packages.py REPORT.json EXPECTED_PROJECT_COUNT

Fails (exit 1) unless the report is a complete version 1 report: no `problems`, a non-empty `projects` list with at
least EXPECTED_PROJECT_COUNT entries (the solution's project count), every project with a `path`, and no advisory of
High or Critical severity anywhere in it (top-level and transitive packages). An empty or truncated report is a
failure, never a pass.
"""
import json
import sys


def fail(message):
    print(f"vulnerable-packages: {message}", file=sys.stderr)
    raise SystemExit(1)


def advisories(value):
    """Every dict carrying a severity, wherever it sits in the report."""
    if isinstance(value, dict):
        if "severity" in value:
            yield value
        for child in value.values():
            yield from advisories(child)
    elif isinstance(value, list):
        for child in value:
            yield from advisories(child)


def main(argv):
    if len(argv) != 3:
        fail("usage: check-vulnerable-packages.py REPORT.json EXPECTED_PROJECT_COUNT")
    try:
        with open(argv[1], encoding="utf-8-sig") as handle:
            report = json.load(handle)
    except (OSError, ValueError) as error:
        fail(f"cannot read the report ({type(error).__name__})")
    expected = int(argv[2])
    if expected < 1:
        fail("the expected project count must be at least 1")
    if not isinstance(report, dict) or report.get("version") != 1:
        fail("not a version 1 report; run dotnet list with --output-version 1")
    if report.get("problems"):
        fail("the package audit did not complete: " + json.dumps(report["problems"])[:500])
    projects = report.get("projects")
    if not isinstance(projects, list) or not projects:
        fail("the report lists no projects")
    if len(projects) < expected:
        fail(f"the report lists {len(projects)} projects, the solution has {expected}")
    if any(not isinstance(project, dict) or not project.get("path") for project in projects):
        fail("a project entry has no path")
    serious = [a for a in advisories(report) if str(a.get("severity", "")).lower() in ("high", "critical")]
    if serious:
        fail(f"{len(serious)} High/Critical advisories: " + ", ".join(sorted({str(a.get('advisoryurl', '?')) for a in serious})))
    print(f"vulnerable-packages: {len(projects)} projects audited, no High/Critical advisories")


if __name__ == "__main__":
    main(sys.argv)
