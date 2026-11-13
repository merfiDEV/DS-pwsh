#!/usr/bin/env python3
"""Render one DS-pwsh bridge log event with Rich."""
import json
import sys

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.syntax import Syntax
    from rich.text import Text
    from rich.align import Align
    from rich.table import Table
except Exception as exc:  # pragma: no cover
    print("rich unavailable: {}".format(exc), file=sys.stderr)
    raise SystemExit(2)


TITLE_ART = r"""
  ____  ____        ____        _
 |  _ \/ ___|      |  _ \__      _| |__
 | | | \___ \ _____| |_) \ \ /\ / / '_ \
 | |_| |___) |_____|  __/ \ V  V /| | | |
 |____/|____/      |_|     \_/\_/ |_| |_|
""".strip("\n")


def build_banner(payload):
    port = payload.get("port")
    shell = str(payload.get("shell") or "")
    cwd = str(payload.get("cwd") or "")
    platform = str(payload.get("platform") or "")
    version = str(payload.get("version") or "")

    art = Text(TITLE_ART, style="bold cyan")

    subtitle = Text()
    subtitle.append("DS-pwsh Terminal Bridge", style="bold white")
    if version:
        subtitle.append("  v" + version, style="dim")
    subtitle.append("   ", style="")
    subtitle.append("\u25cf RUNNING", style="bold green")

    info = Table.grid(padding=(0, 2))
    info.add_column(style="bold", justify="right")
    info.add_column(style="")
    info.add_row("Address", Text("http://127.0.0.1:{}".format(port), style="cyan"))
    info.add_row("Shell", Text(shell))
    info.add_row("Platform", Text(platform))
    info.add_row("Cwd", Text(cwd, overflow="fold"))
    hint = Text("Waiting for commands from the browser extension\u2026", style="dim")
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

    return Panel(
        body,
        title="[bold green]bridge started[/bold green]",
        title_align="left",
        border_style="green",
        padding=(1, 2),
    )


def build_start(payload):
    shell = str(payload.get("shell") or "")
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
    return Panel(body, title=header, title_align="left", border_style="green")


def build_result(payload):
    exit_code = payload.get("exitCode")
    signal_name = payload.get("signal")
    ok = exit_code == 0 and not signal_name
    style = "green" if ok else "red"
    text = Text()
    text.append("<<< ", style="bold " + style)
    text.append("exit={}".format(exit_code), style="bold " + style)
    if signal_name:
        text.append("  signal={}".format(signal_name), style="bold yellow")
    return text


def build_event(payload):
    """Return a Rich renderable for a non-banner event, or None."""
    event = payload.get("event")
    if event == "start":
        return build_start(payload)
    if event == "result":
        return build_result(payload)
    return Text("unknown log event: {!r}".format(event), style="yellow")


def render_banner(payload):
    console = Console(highlight=False)
    console.print(build_banner(payload))


def render(payload):
    console = Console(highlight=False)
    event = payload.get("event")
    if event == "banner":
        render_banner(payload)
        return
    console.print(build_event(payload))


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        return 0
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print("invalid rich-log payload: {}".format(exc), file=sys.stderr)
        return 2
    render(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
