# DS-pwsh Terminal Bridge

This Chrome/Chromium extension connects the real DeepSeek page DOM to a local
terminal process. It does not evaluate JavaScript tool blocks or use Electron.
It only recognizes assistant code blocks labelled `pwsh` on Windows and `bash`
on Linux/macOS.

## Run locally

1. Start the bridge from the project directory you want the AI to work in:

   ```sh
   cd /path/to/your/project
   node /path/to/DS-pwsh/browser-extension/bridge/host.js
   ```

   On Windows, run the equivalent in PowerShell:

   ```pwsh
   Set-Location C:\path\to\your\project
   node C:\path\to\DS-pwsh\browser-extension\bridge\host.js
   ```

   Keep this terminal open. The bridge automatically selects a free port in
   `49152-49183` and prints the selected address. Node.js 18 or later is
   required.

   Before starting the bridge, you can increase the minimum delay before
   command results are returned to DeepSeek. It defaults to 5 seconds and
   accepts values from 5000 to 180000 milliseconds:

   ```sh
   DS_PWSH_MIN_SEND_DELAY_MS=10000 node /path/to/DS-pwsh/browser-extension/bridge/host.js
   ```

   In PowerShell, set `$env:DS_PWSH_MIN_SEND_DELAY_MS = "10000"` before running
   `node`. The setting applies on the bridge server; values below 5000 are
   rejected.

2. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose
   **Load unpacked**, and select this `browser-extension` directory.
   After updating the extension's files, click **Reload** on its card and
   refresh the DeepSeek tab so the new content script is loaded.
3. Open or reload `https://chat.deepseek.com/`. The popup should show the local
   bridge as connected.
   If the page reports that the extension API is unavailable, click **Reload**
   on the extension card and refresh the DeepSeek tab again; an old content
   script can remain attached to an already-open tab after an extension reload.
4. Optionally set a project working directory in the popup. If left blank, the
   bridge uses the directory from which it was started.
5. Copy the instruction from the extension popup and paste it into the chat.
   DeepSeek may return several terminal commands in separate `pwsh` or `bash`
   code blocks; the extension runs them sequentially and sends all results back
   together. A leading Markdown list marker before a command is ignored.

## Execution behavior

Automatic execution is enabled by default, as is returning command output to
the current chat. Turn it off in the popup to stop new command blocks from
running. **Ask before running each command** is enabled by default; turn it off
to run blocks immediately without a confirmation dialog. Choosing **Skip**
skips only that command; later commands in the same response are still
processed in order. A command runs as the current OS user, with access to that
user's files and permissions; do not enable automatic execution for untrusted
chats. Each command times out after 60 seconds and output is capped at 1 MiB.

The extension searches the bridge's small local port range automatically; no
port needs to be configured manually. The bridge accepts requests only from the
extension's Chrome origin and rejects shells that do not match the host OS. The
extension injects only on `chat.deepseek.com`.
