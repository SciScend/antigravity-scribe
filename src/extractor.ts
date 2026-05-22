// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeRole =
  | "user"
  | "agent"
  | "worked"
  | "explored"
  | "thought"
  | "actions" // group container — children are individual 'action' nodes
  | "action" // single action row: Analyzed, Created outline, Read page
  | "ran" // Ran / Edited / Created command row
  | "artifact" // Artifact card (task.md, implementation_plan.md, etc.)
  | "files_modified" // Files Modified section with child filenames
  | "_no_chat";

export interface ConvNode {
  role: NodeRole;
  /** Primary text: user message, "Worked for 1m", "Thought for 3s", verb "Analyzed" … */
  label: string;
  /** Secondary text: chip ref "llms-ctx-full.txt#L1-800", command, thought body, filename */
  detail: string;
  /** Raw innerHTML for agent / thought content — converted to Markdown by renderer */
  html: string | null;
  children: ConvNode[];
}

// ---------------------------------------------------------------------------
// Extract conversation title from the panel header
// ---------------------------------------------------------------------------

export const EXTRACT_TITLE_JS = `(function () {
  const el = document.querySelector(
    "div.flex.min-w-0.items-center.overflow-hidden.text-ellipsis.whitespace-nowrap"
  );
  return el ? el.textContent.replace(/\\s+/g, " ").trim() : "";
})()`;

// ---------------------------------------------------------------------------
// Main extraction — returns ConvNode[] as JSON string
//
// Ported from scraper.py which handles:
//   • User messages (with @mentions)
//   • Thought blocks (collapsed & expanded)
//   • Worked-for wrappers with expanded tool-use children
//   • Explored / Edited action groups
//   • Analyzed rows (file / folder style)
//   • Ran command rows
//   • Artifact cards
//   • Files Modified sections
//   • Standalone agent response text
// ---------------------------------------------------------------------------

export const EXTRACT_JS = `(async function () {

  // ── Auto-scroll to top ─────────────────────────────────────────────────────
  // If the conversation is virtualized or lazy-loaded, we must scroll to the 
  // top to ensure early messages are mounted in the DOM.
  const scrollable = document.querySelector("#conversation .overflow-y-auto");
  if (scrollable) {
    scrollable.scrollTop = 0;
    await new Promise(r => setTimeout(r, 500)); // Wait for lazy loading
  }

  // ── Auto-expand logic ──────────────────────────────────────────────────────
  // The UI is a React app. When blocks (Worked for, Explored) are collapsed,
  // their children are unmounted. We must click them to mount the children.
  
  let expandedSomething = true;
  let iterations = 0;
  while (expandedSomething && iterations < 10) {
    expandedSomething = false;
    iterations++;
    
    const btns = document.querySelectorAll("#conversation button, #conversation div[class*='cursor-pointer'][class*='rounded-lg']");
    for (const btn of btns) {
      const txt = btn.textContent || "";
      
      const isShowMore = txt.includes("Show") && txt.includes("more");
      if (isShowMore && btn.tagName.toLowerCase() === "button") {
        btn.click();
        expandedSomething = true;
        continue;
      }

      const isToolOrThoughtBlock =
        txt.includes("Worked for") ||
        txt.includes("Explored") ||
        txt.includes("Edited") ||
        txt.includes("Thought for") ||
        txt.includes("Thought") ||
        txt.includes("Analyzed");

      if (isToolOrThoughtBlock) {
        const svg = btn.querySelector("svg");
        if (svg && !svg.classList.contains("rotate-90")) {
          btn.click();
          expandedSomething = true;
          continue;
        }

        const gs = btn.querySelector("span.google-symbols");
        if (gs && gs.textContent === "chevron_right" && !gs.classList.contains("rotate-90")) {
          btn.click();
          expandedSomething = true;
        }
      }
    }
    
    if (expandedSomething) {
      await new Promise(r => setTimeout(r, 250)); // Wait for React to render new children
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Join classList to a string for easy includes() checks. */
  function cs(el) {
    return el && el.classList ? [...el.classList].join(" ") : "";
  }

  /** Collapse whitespace and trim. */
  function clean(text) {
    return text ? text.replace(/\\s+/g, " ").trim() : "";
  }

  /**
   * Walk text nodes, skipping:
   *   - SVG elements
   *   - visibility:hidden / display:none elements
   *   - elements with class "hidden" (unless they also have "group-hover:")
   *   - animate-spin spinners
   */
  function walkText(el) {
    const parts = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        parts.push(child.textContent);
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        if (tag === "svg" || tag === "style" || tag === "script") continue;
        const style = child.getAttribute("style") || "";
        if (style.includes("visibility: hidden") || style.includes("display: none")) continue;
        const cls = cs(child);
        if (cls.split(" ").includes("hidden") && !cls.includes("group-hover:")) continue;
        if (cls.includes("animate-spin")) continue;
        parts.push(walkText(child));
      }
    }
    return parts.join(" ");
  }

  function getText(el) {
    return el ? clean(walkText(el)) : "";
  }

  /**
   * Clone the element and remove styles, scripts, SVGs, hidden elements, and spinners
   * so they don't pollute the extracted Markdown.
   */
  function getCleanHTML(el) {
    if (!el) return null;
    const clone = el.cloneNode(true);
    
    // Remove scripts, styles, svgs completely
    const toRemove = clone.querySelectorAll("svg, style, script");
    for (const child of toRemove) {
      child.remove();
    }

    const elements = clone.querySelectorAll("*");
    for (const child of elements) {
      const style = child.getAttribute("style") || "";
      if (style.includes("visibility: hidden") || style.includes("display: none")) {
        child.remove();
        continue;
      }
      const cls = cs(child);
      if (cls.split(" ").includes("hidden") && !cls.includes("group-hover:")) {
        child.remove();
        continue;
      }
      if (cls.includes("animate-spin")) {
        child.remove();
        continue;
      }
    }
    return clone.innerHTML;
  }

  // ── Button verb + detail ───────────────────────────────────────────────────

  /**
   * Action buttons have two <span> children:
   *   span.opacity-70  → verb ("Analyzed", "Explored", "Worked for")
   *   span (no opacity) → detail (filename, "3 files", "1m 30s")
   * Returns [verb, detail].
   */
  function btnParts(btn) {
    const spans = [...btn.children].filter(n => n.tagName === "SPAN");
    let verb = "", detail = "";
    const textSpans = spans.filter(sp => !cs(sp).includes("google-symbols"));
    if (textSpans.length >= 2) {
      verb = getText(textSpans[0]);
      detail = getText(textSpans[1]);
    } else if (textSpans.length === 1) {
      const fullText = getText(textSpans[0]);
      if (fullText.startsWith("Worked for")) {
        verb = "Worked";
        detail = fullText.substring("Worked".length).trim();
      } else if (fullText.startsWith("Worked")) {
        verb = "Worked";
        detail = fullText.substring("Worked".length).trim();
      } else if (fullText.startsWith("Explored")) {
        verb = "Explored";
        detail = fullText.substring("Explored".length).trim();
      } else if (fullText.startsWith("Edited")) {
        verb = "Edited";
        detail = fullText.substring("Edited".length).trim();
      } else if (fullText.startsWith("Thought for")) {
        verb = "Thought";
        detail = fullText.substring("Thought".length).trim();
      } else if (fullText.startsWith("Thought")) {
        verb = "Thought";
        detail = fullText.substring("Thought".length).trim();
      } else {
        const parts = fullText.split(" ");
        verb = parts[0];
        detail = parts.slice(1).join(" ");
      }
    }
    return [verb, detail];
  }

  // ── User message ────────────────────────────────────────────────────────────

  function parseUser(step) {
    const parts = [];
    const imgs = step.querySelectorAll("img");
    for (const img of imgs) {
      const alt = img.getAttribute("alt") || "image";
      const src = img.getAttribute("src") || "";
      const w = img.getAttribute("width") || "";
      if (w && !isNaN(parseInt(w.replace("px", ""))) && parseInt(w.replace("px", "")) <= 16) {
        continue;
      }
      const finalSrc = src.startsWith("data:") ? "embedded-image" : src;
      parts.push("![" + alt + "](" + finalSrc + ")\\n");
    }

    const td = step.querySelector("div.whitespace-pre-wrap.text-sm");
    if (td) {
      const tdParts = [];
      for (const ch of td.childNodes) {
        if (ch.nodeType === 3) {
          tdParts.push(ch.textContent);
        } else if (ch.nodeType === 1) {
          if (cs(ch).includes("context-scope-mention")) {
            tdParts.push("@[" + clean(ch.textContent) + "]");
          } else {
            tdParts.push(ch.textContent);
          }
        }
      }
      parts.push(clean(tdParts.join("")));
    }
    return parts.join("").trim();
  }

  // ── Thought block ───────────────────────────────────────────────────────────

  function parseThought(isolate) {
    const btn = isolate.querySelector("button");
    const sp = btn && btn.querySelector("span.cursor-pointer");
    const header = sp ? getText(sp) : (btn ? getText(btn) : "Thought");

    const cdiv = isolate.querySelector("div.overflow-hidden.transition-all");
    let contentHTML = null;
    if (cdiv) {
      const md = cdiv.querySelector("div.leading-relaxed");
      if (md) contentHTML = getCleanHTML(md);
    }
    return { role: "thought", label: header, detail: "", html: contentHTML, children: [] };
  }

  // ── Analyzed action row ─────────────────────────────────────────────────────

  function parseAnalyzed(row) {
    let action = "";
    const spans = row.querySelectorAll("span");
    for (const sp of spans) {
      const txt = clean(sp.textContent);
      if (txt === "Analyzed" || txt === "Created outline" || txt === "Read page" || txt === "Worked for" || txt === "Explored" || txt === "Edited") {
        action = txt;
        break;
      }
    }
    if (!action) {
      for (const sp of spans) {
        const cls = cs(sp);
        if (cls.includes("opacity-70") || cls.includes("text-secondary-foreground") || cls.includes("shrink-0")) {
          const txt = clean(sp.textContent);
          if (txt && !cls.includes("google-symbols") && txt.length < 20) {
            action = txt;
            break;
          }
        }
      }
    }

    let fname = "";
    const detailSp = row.querySelector("span.break-all, span.select-text, span.inline-flex.break-all");
    if (detailSp) {
      fname = getText(detailSp);
    }
    if (!fname) {
      const btn = row.querySelector("button");
      if (btn) {
        fname = getText(btn);
      }
    }
    if (!fname) {
      for (const sp of spans) {
        const cls = cs(sp);
        if (cls.includes("break-all") || cls.includes("select-text")) {
          fname = getText(sp);
          break;
        }
      }
    }
    return { role: "action", label: action, detail: fname, html: null, children: [] };
  }

  // ── Ran command row ─────────────────────────────────────────────────────────

  function parseRan(row) {
    const sp = row.querySelector("span.font-mono");
    return { role: "ran", label: "Ran", detail: sp ? clean(sp.textContent) : "", html: null, children: [] };
  }

  // ── Artifact card ───────────────────────────────────────────────────────────

  function parseArtifact(card) {
    const ts = card.querySelector("span.inline-flex.break-all");
    const title = ts ? getText(ts) : "";
    const ds = card.querySelector("span.text-sm.opacity-70.line-clamp-3");
    const desc = ds ? getText(ds) : "";
    return { role: "artifact", label: title, detail: desc, html: null, children: [] };
  }

  // ── Files Modified section ──────────────────────────────────────────────────

  function parseFilesModified(section) {
    const fms = section.querySelectorAll("span.inline-flex.break-all");
    const children = [...fms]
      .map(fm => ({ role: "action", label: getText(fm), detail: "", html: null, children: [] }))
      .filter(n => n.label);
    return { role: "files_modified", label: "Files Modified", detail: "", html: null, children };
  }

  // ── Searched / generic action row ──────────────────────────────────────────

  /**
   * Parses "Searched", "Analyzed", and other generic action rows that have
   * a span.opacity-70 verb but aren't "Ran". Mirrors scraper.py _parse_search_item().
   *
   * DOM shape (inside an Explored expanded block):
   *   <div class="flex flex-row">
   *     ...deep nesting...
   *       <div class="flex items-center gap-1 ...">
   *         <span class="opacity-70">Searched</span>
   *         <span class="overflow-hidden text-ellipsis ...">asset</span>
   *         <span class="shrink-0 rounded-full ...">4 results</span>
   *
   * Returns a ConvNode with: label = verb, detail = "query (count)"
   */
  function parseSearchItem(row) {
    const spans = row.querySelectorAll("span");
    let action = "", query = "", count = "";
    for (const sp of spans) {
      const cls = cs(sp);
      const t = clean(sp.textContent);
      if (!t) continue;
      if (cls.includes("google-symbols")) continue;
      if (!action && (cls.includes("opacity-70") || cls.includes("text-secondary-foreground"))) { action = t; continue; }
      if (!count && cls.includes("rounded-full")) { count = t; continue; }
      if (!query) { query = t; }
    }
    const detail = [query ? \`\\\`\${query}\\\`\` : "", count].filter(Boolean).join(" ");
    return { role: "action", label: action, detail, html: null, children: [] };
  }

  // ── Recursive content walker ────────────────────────────────────────────────

  /**
   * Mirrors scraper.py _walk(): traverses the expanded content area inside
   * a Worked-for or Explored block and returns a flat list of ConvNodes.
   */
  function walk(container) {
    const items = [];
    if (!container) return items;

    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];
      const cls = cs(child);
      const classes = cls.split(" ");

      // ── Thought blocks (.isolate) ──────────────────────────────────────
      if (classes.includes("isolate")) {
        const btn = child.querySelector("button");
        if (btn && getText(btn).includes("Thought for")) {
          items.push(parseThought(child));
        }
        continue;
      }

      // ── Explored / Edited action group (div.relative with button) ──────
      if (child.tagName === "DIV" && classes.includes("relative")) {
        const btn = child.querySelector(":scope > button");
        if (btn) {
          const [v, d] = btnParts(btn);
          if (v === "Explored" || v === "Edited") {
            const children = [];
            
            // 1. Check inside the block (offline HTML case)
            for (const c2 of child.children) {
              if (c2.tagName !== "BUTTON") {
                children.push(...walk(c2));
              }
            }
            
            // 2. Check next sibling (live DOM case)
            if (children.length === 0 && i + 1 < container.children.length) {
              const nextSib = container.children[i + 1];
              if (nextSib && nextSib.tagName === "DIV" && !nextSib.querySelector(":scope > button")) {
                children.push(...walk(nextSib));
                i++; // Skip the sibling so it doesn't get processed again
              }
            }
            
            items.push({ role: "explored", label: v, detail: d, html: null, children });
          }
        } else {
          // No button — plain wrapper div; recurse
          items.push(...walk(child));
        }
        continue;
      }

      // ── flex-row divs: Ran / Analyzed ──────────────────────────────────
      if (child.tagName === "DIV" && cls.includes("flex-row")) {
        // Ran command
        const ranSp = child.querySelector("span.opacity-70");
        if (ranSp && getText(ranSp).includes("Ran")) {
          items.push(parseRan(child));
          continue;
        }

        // Searched / Analyzed / other action items:
        // span.opacity-70 exists but verb isn't "Ran" (e.g. "Searched", "Analyzed")
        if (ranSp) {
          const node = parseSearchItem(child);
          if (node.label || node.detail) items.push(node);
          continue;
        }

        // Legacy analyzed row (span with both shrink-0 and opacity-70)
        const al = child.querySelector("span.shrink-0.opacity-70");
        if (al) {
          const node = parseAnalyzed(child);
          if (node.label || node.detail) items.push(node);
          continue;
        }

        // Folder-style analyzed (collapsible directory)
        const ad = child.querySelector("[class*=cursor-pointer][class*=rounded-lg]");
        if (ad) {
          const node = parseAnalyzed(ad);
          if (node.label || node.detail) {
            const subChildren = [];
            const subC = child.querySelector("div.overflow-hidden.pl-3");
            if (subC) {
              const rows = subC.querySelectorAll("div.flex.items-center, div.flex.flex-row");
              for (const sr of rows) {
                if (sr.querySelector("button, div.cursor-pointer")) {
                  continue;
                }
                const textDiv = sr.querySelector("div.whitespace-nowrap.truncate, div.truncate");
                if (textDiv) {
                  const fname = clean(textDiv.textContent);
                  if (fname && !fname.includes("Show") && !fname.includes("more")) {
                    subChildren.push({ role: "action", label: fname, detail: "", html: null, children: [] });
                  }
                }
              }
            }
            node.children = subChildren;
            items.push(node);
          }
          continue;
        }
      }

      // ── Response text block (px-2 py-1 wrapper) ────────────────────────
      if (child.tagName === "DIV" && cls.includes("px-2") && cls.includes("py-1")) {
        const md = child.querySelector("div.leading-relaxed");
        if (md) {
          const t = clean(md.textContent);
          if (t && t.length > 3) {
            items.push({ role: "agent", label: "", detail: "", html: getCleanHTML(md), children: [] });
          }
        }
        continue;
      }

      // ── Any other div — recurse ────────────────────────────────────────
      if (child.tagName === "DIV") {
        items.push(...walk(child));
      }
    }

    return items;
  }

  // ── Turn parser ─────────────────────────────────────────────────────────────

  function parseTurn(turnDiv) {
    const nodes = [];
    const group = turnDiv.querySelector("div.flex.flex-col.group.w-full") || turnDiv;

    // ── User message ───────────────────────────────────────────────────────
    const us = group.querySelector("[data-testid='user-input-step']");
    if (us) {
      const userText = parseUser(us);
      if (userText) {
        nodes.push({ role: "user", label: userText, detail: "", html: null, children: [] });
      }
    }

    // ── Agent content (all children of group) ─────────────────────────────
    for (const child of group.children) {
      const cls = cs(child);
      const classes = cls.split(" ");

      // Skip sticky header
      if (classes.includes("sticky")) continue;

      // Skip timestamp row
      if (cls.includes("pt-3")) continue;

      // ── Artifact cards ─────────────────────────────────────────────────
      const cards = child.querySelectorAll("div.border.p-2");
      if (cards.length > 0) {
        for (const card of cards) {
          const node = parseArtifact(card);
          if (node.label) nodes.push(node);
        }
        // If there's also response text in this container, fall through
        if (!child.querySelector("div.leading-relaxed.select-text")) continue;
      }

      // ── Files Modified ─────────────────────────────────────────────────
      const fl = child.querySelector("span.text-sm.opacity-70");
      if (fl && getText(fl).includes("Files Modified")) {
        const node = parseFilesModified(child);
        if (node.children.length > 0) nodes.push(node);
        continue;
      }

      // ── Worked-for block ───────────────────────────────────────────────
      // Scan direct children for a div.relative containing a "Worked" button.
      let workedBtnContainer = null;

      outer: for (const sub of child.children) {
        const subCls = cs(sub);
        if (sub.tagName === "DIV" && subCls.includes("relative")) {
          const btn = sub.querySelector(":scope > button");
          if (btn) {
            const [v, d] = btnParts(btn);
            if (v && v.includes("Worked")) {
              nodes.push({ role: "worked", label: (v + " " + d).trim(), detail: "", html: null, children: [] });
              workedBtnContainer = sub;
              break outer;
            }
          }
        } else if (sub.tagName === "DIV") {
          // One level deeper — some layouts nest the worked button
          const innerBtn = sub.querySelector(":scope > div.relative > button");
          if (innerBtn) {
            const [v, d] = btnParts(innerBtn);
            if (v && v.includes("Worked")) {
              nodes.push({ role: "worked", label: (v + " " + d).trim(), detail: "", html: null, children: [] });
              workedBtnContainer = innerBtn.parentElement;
              break outer;
            }
          }
        }
      }

      if (workedBtnContainer) {
        // Expanded tool-use steps live in the div[style*='opacity: 1'] sibling
        let workedChildren = [];
        
        // 1. Check inside workedBtnContainer (offline HTML export case)
        for (const c2 of workedBtnContainer.children) {
          if (c2.tagName !== "BUTTON") {
            workedChildren.push(...walk(c2));
          }
        }

        // Find the direct child of 'child' that contains the workedBtnContainer
        let directChildContainingWorked = workedBtnContainer;
        while (directChildContainingWorked && directChildContainingWorked.parentElement !== child) {
          directChildContainingWorked = directChildContainingWorked.parentElement;
        }

        // Attach reference to the worked node before we process siblings
        const workedNode = nodes[nodes.length - 1];

        // 2. Find siblings in the live DOM
        let passedWorked = false;
        for (const sib of child.children) {
          if (sib === directChildContainingWorked) { passedWorked = true; continue; }
          if (!passedWorked) continue;
          
          const sibCls = cs(sib);
          if (sibCls.includes("px-2") && sibCls.includes("py-1")) {
            // It's the final response text block! Push to nodes at root level.
            const md = sib.querySelector("div.leading-relaxed");
            if (md) {
              const t = clean(md.textContent);
              if (t && t.length > 3) {
                nodes.push({ role: "agent", label: "", detail: "", html: getCleanHTML(md), children: [] });
              }
            }
          } else {
            // It's a tool container block sibling (live DOM case)
            workedChildren.push(...walk(sib));
          }
        }

        // 3. Attach all collected children
        if (workedNode && workedNode.role === "worked") {
          workedNode.children = workedChildren;
        }
        continue;
      }

      // ── Standalone thought (no Worked wrapper) ─────────────────────────
      const iso = child.querySelector("div.isolate");
      if (iso) {
        const btn = iso.querySelector("button");
        if (btn && getText(btn).includes("Thought for")) {
          nodes.push(parseThought(iso));
          // Response text in the same container
          for (const sibCh of child.querySelectorAll("div.px-2.py-1")) {
            const md = sibCh.querySelector("div.leading-relaxed");
            if (md) {
              const t = clean(md.textContent);
              if (t && t.length > 3) {
                nodes.push({ role: "agent", label: "", detail: "", html: getCleanHTML(md), children: [] });
              }
            }
          }
          continue;
        }
      }

      // ── Standalone response text ───────────────────────────────────────
      const mds = child.querySelectorAll("div.leading-relaxed.select-text");
      for (const md of mds) {
        // Skip if inside an opacity-0 ancestor (hidden/faded content)
        let skip = false;
        let p = md.parentElement;
        while (p && p !== child) {
          if (cs(p).includes("opacity-0")) { skip = true; break; }
          p = p.parentElement;
        }
        if (skip) continue;
        const t = clean(md.textContent);
        if (t && t.length > 3) {
          nodes.push({ role: "agent", label: "", detail: "", html: getCleanHTML(md), children: [] });
        }
      }
    }

    return nodes;
  }

  // ── Entry point ─────────────────────────────────────────────────────────────

  const conv = document.querySelector("#conversation");
  if (!conv) {
    return JSON.stringify([
      { role: "_no_chat", label: "Chat panel not found", detail: "", html: null, children: [] }
    ]);
  }

  const allNodes = [];
  const turnDivs = conv.querySelectorAll(
    "div.relative.flex.flex-col.gap-y-3 > div.flex.items-start"
  );

  for (const turnDiv of turnDivs) {
    allNodes.push(...parseTurn(turnDiv));
  }

  return JSON.stringify(allNodes);
})()`;
