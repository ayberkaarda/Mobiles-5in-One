# Fixture for iv-python-subprocess-shell (semgrep --test).
import asyncio
import os
import subprocess


async def positives(name: str) -> None:
    # ruleid: iv-python-subprocess-shell
    subprocess.run(f"pg_dump {name}", shell=True, check=True)
    # ruleid: iv-python-subprocess-shell
    subprocess.check_output("ls " + name, shell=True)
    # ruleid: iv-python-subprocess-shell
    os.system("rm -rf " + name)
    # ruleid: iv-python-subprocess-shell
    os.popen("cat " + name)
    # ruleid: iv-python-subprocess-shell
    await asyncio.create_subprocess_shell("tar czf out.tgz " + name)


async def negatives(name: str) -> None:
    # ok: iv-python-subprocess-shell
    subprocess.run(["pg_dump", name], check=True)
    # ok: iv-python-subprocess-shell
    subprocess.run(["ls", name], shell=False, check=True)
    # ok: iv-python-subprocess-shell
    await asyncio.create_subprocess_exec("tar", "czf", "out.tgz", name)
