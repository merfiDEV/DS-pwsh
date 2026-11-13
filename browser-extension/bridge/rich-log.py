#!/usr/bin/env python3
"""Render DS-pwsh bridge log events with Rich.

Reads a single JSON object from stdin and prints a styled representation.
Supported events:
  {"event": "start",  "shell": "...", "cwd": "...", "command": "..."}
  {"event": "result", "shell": "...", "exitCode": 0, "signal": null}

Exits non-zero (without traceback) if Rich is unavailable, so the caller
can fall back to plain console logging.
"""
import json
import sys

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.syntax import Syntax
    from rich.text import Text
except Exception as exc:  # pragma: no cover - optional dependency
    print(f"rich unavailable: {exc}", file=sys.stderr)
    raise SystemExit(2)


def render(payload: dict) -> None:
    console = Console(highlight=False)
    event = payload.get("event")
    shell = str(payload.get("shell") or "")

    if event == "start":
        cwd = str(payload.get("cwd") or "")
        command = str(payload.get("command") or "")
        lexer = "powershell" if shell == "pwsh" else "bash"
        header = Text()
        header.append(">>> ", style="bold green")
        header.append(shell or "shell", style="bold cyan")
        header.append("  cwd: ", style="dim")
        header.append(cwd, style="dim")
        body = Syntax(
            command,
            lexer,
            theme="monokai",
            line_numbers=False,
            word_wrap=True,
            background_color="default",
        )
        console.print(Panel(body, title=header, title_align="left", border_style="green"))
        return

    if event == "result":
        exit_code = payload.get("exitCode")
        signal = payload.get("signal")
        ok = exit_code == 0 and not signal
        style = "green" if ok else "red"
        label = "exit"
        text = Text()
        text.append("<<< ", style=f"bold {style}")
        text.append(f"{label}={exit_code}", style=f"bold {style}")
        if signal:
            text.append(f"  signal={signal}", style="bold yellow")
        console.print(text)
        return

    console.print(Text(f"unknown log event: {event!r}", style="yellow"))


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        return 0
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"invalid rich-log payload: {exc}", file=sys.stderr)
        return 2
    render(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
