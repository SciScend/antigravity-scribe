# Antigravity Scribe

Capture thinking, tool calls & artifacts from [Google Antigravity IDE](https://antigravity.google) sessions directly into your Obsidian vault as structured Markdown notes.
No copy-pasting. No manual logging. No digging through AG's folders. Run the capture when your session is done and the note appears.


## Features

- **Full Session Capture:** Automatically extracts chat turns, thinking blocks, tool call summaries. Artifacts are intentionally excluded from the main capture, as they can be easily accessed in brain folder by `brain_path/brain_uuid` given in capture metadata. .
- **Obsidian Integration:** Writes notes directly to your vault with proper YAML frontmatter and folder organization.
- **Auto-Scroll & Expand:** Uses CDP to intelligently scroll the chat panel and expand all collapsed blocks (Worked for, Thought for, Explored) to ensure no content is missed.
- **Diagnostics:** Built-in connection check to verify your CDP port and brain path configuration.

---

## Extension Settings

This extension contributes the following settings:

* `agscribe.vaultPath`: **(Required)** Absolute path to your Obsidian vault root.
* `agscribe.vaultFolder`: Folder inside the vault for session notes (default: `AgentSessions`).
* `agscribe.brainPath`: Path to Antigravity brain directory (default: `~/.gemini/antigravity-ide/brain`).
* `agscribe.port`: CDP remote debugging port (default: `9222`).
* `agscribe.openAfterCapture`: Automatically open the captured note in the editor (default: `true`).

---

## Getting Started

### Step 1 — Launch Antigravity with CDP enabled

Antigravity Scribe connects to Antigravity via the Chrome DevTools Protocol. You must start Antigravity with the debug port flag.

**Linux / macOS:**
```bash
antigravity --remote-debugging-port=9222
```

**If you use a launcher script or `.desktop` entry**, add the flag to the `Exec=` line:
```ini
Exec=/usr/bin/antigravity --remote-debugging-port=9222 %F
```

---

### Step 2 — Verify the setup with diagnostics

Before your first real capture, run:

```
Antigravity Scribe: Diagnose Connection
```

You should see:
```
=== Antigravity Scribe Diagnostics ===

✅ CDP port 9222: Antigravity - my-project
✅ Brain path:    /home/yourname/.gemini/antigravity-ide/brain
   Active brain UUID: 50fa0573-52e0-4755-96f4-c98d1e808133
✅ Vault path:    /home/yourname/Obsidian/Vault
```

---

### Step 3 — Capture

When ready, choose one of:

| Method                                                                                                             | When to use                                                     |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Click **<img src="assets/device-camera.png" width="16" height="16" align="center" /> AG Scribe** in the status bar | Quick capture, auto-generates task name from conversation title |
| Command Palette → `Antigravity Scribe: Capture Session (named task)`                                               | When you want to give this session a custom label               |

---

## Commands

| Command                                            | Description                                                |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `Antigravity Scribe: Capture Session`              | Capture using conversation title (or last-used task label) |
| `Antigravity Scribe: Capture Session (named task)` | Prompt for a label, then capture                           |
| `Antigravity Scribe: Open Sessions in Vault`       | Reveal the sessions folder in the Explorer sidebar         |
| `Antigravity Scribe: Diagnose Connection`          | Check CDP, brain path, and vault config                    |

---

## Output Format

The extension generates a structured Markdown file in your vault with:

- **YAML Frontmatter:**
    - `date`, `time`: Capture timestamp.
    - `agent`: The AI model used (e.g., `antigravity`).
    - `task`: The task label (e.g., `fixing-antigravity-scribe-counter`).
    - `workspace`: Local path to the project.
    - `brain_uuid`: Unique ID for the specific session.
    - `brain_path`: Absolute path to the Antigravity brain data.
    - `tags`: Standard tags like `agent-session` and `antigravity`.

- **Session Content:**
    - `## Session` header.
    - `## 👤 USER` and `## 🤖 AGENT` markers for each turn.
    - `## ⏱ Worked for [time]` blocks containing:
        - `### 🔍 Explored — [summary]` tool call descriptions.
        - `#### 🧠 Thought for [time]` internal reasoning blocks.
    - High-fidelity Markdown conversion of agent responses (using Turndown).

---

## Custom Antigravity Profiles

If you launch Antigravity with `--user-data-dir` pointing to a custom location, you will need to point `agscribe.brainPath` to the `brain` directory within that profile.

---

## Troubleshooting

### `No Antigravity CDP target on port 9222`
- Ensure Antigravity is running with `--remote-debugging-port=9222`.
- Check if another process is using the port.

### `Chat panel not found`
- Ensure a conversation is active and visible in the Antigravity side panel.

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to get started.

## License

MIT © 2026 [SciScend]
