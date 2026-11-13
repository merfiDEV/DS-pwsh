#!/usr/bin/env python3
"""Render DS-pwsh bridge log events with Rich.

Reads a single JSON object from stdin and prints a styled representation.
Supported events:
  {"event": "start",  "shell": "...", "cwd": "...", "command": "..."}
  {"event": "result", "shell": "...", "exitCode": 0, "signal": null}
  {"event": "banner", "port": 49152, "shell": "...", "cwd": "...",
                      "platform": "...", "version": "1.1.6"}

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
    from rich.align import Align
    from rich.table import Table
except Exception as exc:  # pragma: no cover - optional dependency
    print(f"rich unavailable: {exc}", file=sys.stderr)
    raise SystemExit(2)


TITLE_ART = r"""
  ____  ____        ____        _
 |  _ \/ ___|      |  _ \__      _| |__  
 | | | \___ \ _____| |_) \ \ /\ / / '_ \ 
 | |_| |___) |_____|  __/ \ V  V /| | | |
 |____/|____/      |_|     \_/\_/ |_| |_|
""".strip("\n")


def render_banner(payload: dict) -> None:
    console = Console(highlight=False)
    port = payload.get("port")
    shell = str(payload.get("shell") or "")
    cwd = str(payload.get("cwd") or "")
    platform = str(payload.get("platform") or "")
    version = str(payload.get("version") or "")

    art = Text(TITLE_ART, style="bold cyan")

    subtitle = Text()
    subtitle.append("DS-pwsh Terminal Bridge", style="bold white")
    if version:
        subtitle.append(f"  v{version}", style="dim")
    subtitle.append("   ", style="")
    subtitle.append("● RUNNING", style="bold green")

    info = Table.grid(padding=(0, 2))
    info.add_column(style="bold", justify="right")
    info.add_column(style="")
    info.add_row("Address", f"[cyan]http://127.0.0.1:{port}[/cyan]")
    info.add_row("Shell", shell)
    info.add_row("Platform", platform)
    info.add_row("Cwd", cwd)

    hint = Text("Waiting for commands from the browser extension…", style="dim")
    hint.append("\nPress Ctrl+C to stop.", style="dim")

    body = Table.grid(padding=(0, 0))
    body.add_column()
    body.add_row(Align.center(art))
    body.add_row(Text(""))
    body.add_row(Align.center(subtitle))
    body.add_row(Text(""))
    body.add_row(info)
    body.add_row(Text(""))
    body.add_row(Align.center(hint))

    console.print(
        Panel(
            body,
            title="[bold green]bridge started[/bold green]",
            title_align="left",
            border_style="green",
            padding=(1, 2),
        )
    )


def render(payload: dict) -> None:
    console = Console(highlight=False)
    event = payload.get("event")
    shell = str(payload.get("shell") or "")

    if event == "banner":
        render_banner(payload)
        return

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
