import TurndownService from "turndown";
import { ConvNode } from "./extractor";

export interface RenderOptions {
  task: string;
  workspacePath: string;
  brainUuid?: string;
  brainFullPath?: string;
  agent?: string;
}

// ---------------------------------------------------------------------------
// Turndown instance
// ---------------------------------------------------------------------------

const td = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Ignore images since we no longer capture them
td.addRule("ignoreImages", {
  filter: "img",
  replacement: () => "",
});

// Explicitly remove styling and script elements just in case any slip through
td.remove(["style", "script", "noscript", "svg"]);

function htmlToMarkdown(html: string): string {
  return td.turndown(html).trim();
}

// ---------------------------------------------------------------------------
// Heading depth per role
//
// Rendered structure mirrors the visual hierarchy in the panel:
//   ## 👤 USER / ## 🤖 AGENT          (top-level turns)
//   ### ⏱ Worked for 1m               (tool-use block)
//   #### 🔍 Explored 3 files, 2 pages  (sub-step group)
//   ##### 🧠 Thought for 3s            (thought inside explored)
//   ##### 🔧 Actions                   (action group inside explored)
//   #### ▶ Ran `curl ...`              (command at worked level)
//   #### 📄 Artifact                   (artifact card at agent level)
//   #### 📁 Files Modified             (files modified section)
// ---------------------------------------------------------------------------

const EMOJI: Record<string, string> = {
  user: "\u{1F464}", // 👤
  agent: "\u{1F916}", // 🤖
  worked: "\u23F1", // ⏱
  explored: "\u{1F50D}", // 🔍
  thought: "\u{1F9E0}", // 🧠
  actions: "\u{1F527}", // 🔧
  ran: "\u25B6", // ▶
  artifact: "\u{1F4C4}", // 📄
  files_modified: "\u{1F4C1}", // 📁
};

function h(depth: number): string {
  return "#".repeat(Math.min(depth, 6));
}

// ---------------------------------------------------------------------------
// renderNode — recursive
// ---------------------------------------------------------------------------

function renderNode(node: ConvNode, lines: string[], depth = 2): void {
  switch (node.role) {
    // ── User message ────────────────────────────────────────────────────────
    case "user":
      lines.push(`${h(depth)} ${EMOJI.user} USER`);
      lines.push("");
      lines.push(node.label);
      lines.push("");
      break;

    // ── Agent response ───────────────────────────────────────────────────────
    case "agent":
      if (!node.html && !node.label) break;
      lines.push(`${h(depth)} ${EMOJI.agent} AGENT`);
      lines.push("");
      if (node.html) {
        lines.push(htmlToMarkdown(node.html));
      } else if (node.label) {
        lines.push(node.label);
      }
      lines.push("");
      break;

    // ── Worked-for block ────────────────────────────────────────────────────
    case "worked":
      lines.push(`${h(depth)} ${EMOJI.worked} ${node.label}`);
      lines.push("");
      for (const child of node.children) {
        renderNode(child, lines, depth + 1);
      }
      break;

    // ── Explored / Edited group ─────────────────────────────────────────────
    case "explored": {
      const detail = node.detail ? ` — ${node.detail}` : "";
      lines.push(`${h(depth)} ${EMOJI.explored} ${node.label}${detail}`);
      lines.push("");
      for (const child of node.children) {
        renderNode(child, lines, depth + 1);
      }
      break;
    }

    // ── Thought block ────────────────────────────────────────────────────────
    case "thought":
      lines.push(`${h(depth)} ${EMOJI.thought} ${node.label}`);
      lines.push("");
      if (node.html) {
        lines.push(htmlToMarkdown(node.html));
        lines.push("");
      } else if (node.detail) {
        lines.push(`> ${node.detail}`);
        lines.push("");
      }
      break;

    // ── Actions container ────────────────────────────────────────────────────
    case "actions":
      lines.push(`${h(depth)} ${EMOJI.actions} Actions`);
      lines.push("");
      for (const child of node.children) {
        // 'action' nodes inside 'actions' render as list items
        if (child.role === "action") {
          const detail = child.detail ? ` \`${child.detail}\`` : "";
          lines.push(`- ${child.label}${detail}`);
        } else {
          renderNode(child, lines, depth + 1);
        }
      }
      lines.push("");
      break;

    // ── Single action (Analyzed, Read page, …) ────────────────────────────
    case "action": {
      // Standalone action (not inside an 'actions' container): list item
      const detail = node.detail ? ` \`${node.detail}\`` : "";
      const label = node.label || node.detail;
      if (label) {
        lines.push(`- ${node.label}${detail}`);
        // Sub-items (folder expansion)
        for (const child of node.children) {
          if (child.role === "action") {
            const cd = child.detail ? ` \`${child.detail}\`` : "";
            lines.push(`  - ${child.label}${cd}`);
          }
        }
      }
      break;
    }

    // ── Ran command ─────────────────────────────────────────────────────────
    case "ran":
      lines.push(`${h(depth)} ${EMOJI.ran} Ran`);
      lines.push("");
      if (node.detail) {
        lines.push(`\`\`\`\n${node.detail}\n\`\`\``);
      }
      lines.push("");
      break;

    // ── Artifact card ────────────────────────────────────────────────────────
    case "artifact":
      lines.push(`${h(depth)} ${EMOJI.artifact} ${node.label || "Artifact"}`);
      lines.push("");
      if (node.detail) {
        lines.push(`> ${node.detail}`);
        lines.push("");
      }
      break;

    // ── Files Modified section ───────────────────────────────────────────────
    case "files_modified":
      lines.push(`${h(depth)} ${EMOJI.files_modified} Files Modified`);
      lines.push("");
      for (const child of node.children) {
        if (child.label) {
          lines.push(`- \`${child.label}\``);
        }
      }
      lines.push("");
      break;

    // ── No chat panel found ──────────────────────────────────────────────────
    case "_no_chat":
      lines.push(`> ⚠️ ${node.label}`);
      if (node.detail) {
        lines.push("");
        lines.push(`\`\`\`html\n${node.detail}\n\`\`\``);
      }
      lines.push("");
      break;
  }
}

// ---------------------------------------------------------------------------
// renderNote — public entry point
// ---------------------------------------------------------------------------

export function renderNote(nodes: ConvNode[], opts: RenderOptions): string {
  const now = new Date();
  const lines: string[] = [];

  // ── Frontmatter ──────────────────────────────────────────────────────────
  lines.push("---");
  lines.push(`date: ${now.toISOString().slice(0, 10)}`);
  lines.push(`time: ${now.toTimeString().slice(0, 5)}`);
  lines.push(`agent: ${opts.agent || "antigravity"}`);
  lines.push(`task: ${opts.task}`);
  lines.push(`workspace: "${opts.workspacePath}"`);
  if (opts.brainUuid) {
    lines.push(`brain_uuid: ${opts.brainUuid}`);
  }
  if (opts.brainFullPath) {
    lines.push(`brain_path: "${opts.brainFullPath}"`);
  }
  lines.push("tags:");
  lines.push("  - agent-session");
  lines.push("  - antigravity");
  lines.push("---");
  lines.push("");

  // ── Session ───────────────────────────────────────────────────────────────
  lines.push("## Session");
  lines.push("");

  for (const node of nodes) {
    renderNode(node, lines);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sessionFilename(task: string, date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = date;
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const hm = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const slug =
    task
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "session";
  return `${ymd}_${hm}_${slug}.md`;
}
