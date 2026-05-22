import * as vscode from "vscode";
import * as fs from "fs";
import { findTarget, CDPClient } from "./cdp";
import { EXTRACT_JS, EXTRACT_TITLE_JS, ConvNode } from "./extractor";
import { renderNote, sessionFilename } from "./renderer";
import { prepareVault, writeNote } from "./vault";
import { getActiveBrainUuid } from "./utils";

export interface SnapResult {
  outPath: string;
  nodeCount: number;
  skipped?: boolean;
}

export async function runSnap(task: string): Promise<SnapResult> {
  const cfg = vscode.workspace.getConfiguration("agscribe");
  const port = cfg.get<number>("port", 9222);
  const vaultPath = cfg.get<string>("vaultPath", "");
  const vaultFolder = cfg.get<string>("vaultFolder", "AgentSessions");
  const brainPath = cfg.get<string>("brainPath", "~/.gemini/antigravity-ide/brain");

  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  // ── 1. CDP: extract conversation tree ─────────────────────────────────────
  const target = await findTarget(port);
  if (!target) {
    throw new Error(
      `No Antigravity CDP target on port ${port}.\n` +
        `Make sure Antigravity is running with --remote-debugging-port=${port}.`,
    );
  }

  const cdp = new CDPClient();
  await cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");

  let raw: string | null;
  let conversationTitle: string | null;
  try {
    raw = await cdp.evalJS(EXTRACT_JS);
    conversationTitle = await cdp.evalJS(EXTRACT_TITLE_JS);
  } finally {
    cdp.close();
  }

  if (!raw) {
    throw new Error("JS extraction returned nothing — is Antigravity responding?");
  }

  const nodes: ConvNode[] = JSON.parse(raw);

  if (nodes.length === 1 && nodes[0].role === "_no_chat") {
    throw new Error("Chat panel not found — is a conversation open in Antigravity?");
  }

  if (nodes.length === 0) {
    vscode.window.showWarningMessage(
      "Antigravity Scribe: Conversation is empty — start a conversation before capturing.",
    );
    return { outPath: "", nodeCount: 0, skipped: true };
  }

  // ── 1b. Resolve effective task label ──────────────────────────────────────
  const effectiveTask =
    task === "session" && conversationTitle
      ? conversationTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 50)
      : task;

  // ── 2. Vault: prepare dirs ─────────────────────────────────────────────────
  const { sessionDir } = prepareVault(vaultPath, vaultFolder);

  // ── 3. Render and write note ───────────────────────────────────────────────
  const now = new Date();
  const { uuid: brainUuid, fullPath: brainFullPath } = getActiveBrainUuid(brainPath);

  const note = renderNote(nodes, {
    task: effectiveTask,
    workspacePath: wsFolder,
    brainUuid: brainUuid || undefined,
    brainFullPath: brainFullPath || undefined,
  });

  const filename = sessionFilename(effectiveTask, now);
  const outPath = writeNote(sessionDir, filename, note);

  return {
    outPath,
    nodeCount: nodes.length,
  };
}

// ---------------------------------------------------------------------------
// Diagnostic: report config state without capturing
// ---------------------------------------------------------------------------
export async function runDiagnose(out: vscode.OutputChannel): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("agscribe");
  const port = cfg.get<number>("port", 9222);
  const vaultPath = cfg.get<string>("vaultPath", "");
  const brainPath = cfg.get<string>("brainPath", "~/.gemini/antigravity-ide/brain");

  out.clear();
  out.show(true);

  const ok = (msg: string) => out.appendLine(`✅ ${msg}`);
  const err = (msg: string) => out.appendLine(`❌ ${msg}`);
  const info = (msg: string) => out.appendLine(`   ${msg}`);

  out.appendLine("=== Antigravity Scribe Diagnostics ===");
  out.appendLine("");

  // CDP
  const target = await findTarget(port);
  if (target) {
    ok(`CDP port ${port}: ${target.title?.slice(0, 60)}`);
  } else {
    err(`CDP port ${port}: No target found`);
    info(`Launch Antigravity with --remote-debugging-port=${port}`);
  }

  // Brain
  const { uuid: brainUuid, fullPath: brainFullPath } = getActiveBrainUuid(brainPath);
  if (fs.existsSync(brainFullPath)) {
    ok(`Brain path:    ${brainFullPath}`);
    if (brainUuid) {
      out.appendLine(`   Active brain UUID: ${brainUuid}`);
    } else {
      err(`Active brain UUID: Not found`);
      info(`No active session directory found in brain path.`);
    }
  } else {
    err(`Brain path:    ${brainFullPath} (not found)`);
    info(`Open Settings → search 'Antigravity Scribe' → set Brain Path`);
  }

  // Vault
  if (vaultPath) {
    ok(`Vault path: ${vaultPath}`);
  } else {
    err(`Vault path: Not configured`);
    info(`Open Settings → search 'Antigravity Scribe' → set Vault Path`);
  }

  out.appendLine("");
}
