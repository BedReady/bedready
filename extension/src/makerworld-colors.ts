// MakerWorld browsing helper — badge each model card with how many colours it uses, so you can spot a
// 6–8 colour model to test WITHOUT opening or downloading anything.
//
// The grid card DOM carries NO colour info (confirmed: cards render only the thumbnail + a "new version"
// badge). MakerWorld is a Next.js app, so the real data rides in the page's embedded JSON (__NEXT_DATA__
// or the App-Router flight-data <script>s). We read the model objects out of that JSON — with the user's
// session already loaded, no API call and no .3mf download — count each model's distinct filament colours,
// and badge the matching card. A floating "min colors" filter dims cards below a threshold.

const DEBUG = /[?&]bedreadyDebug/.test(location.search);
const HEX = /#?[0-9a-fA-F]{6}\b/g;

// Every /models/<id> currently on the page, and its card element (the repeating grid cell).
function pageCards(): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLAnchorElement>('a[href*="/models/"]').forEach((a) => {
    const id = a.getAttribute("href")?.match(/\/models\/(\d+)/)?.[1];
    if (!id) return;
    let node: HTMLElement = a;
    for (let i = 0; i < 9 && node.parentElement; i++) {
      const cells = [...node.parentElement.children].filter((c) => c.querySelector?.('a[href*="/models/"]'));
      if (cells.length >= 4) break;
      node = node.parentElement;
    }
    if (!out.has(id)) out.set(id, node);
  });
  return out;
}

// Parse every embedded JSON blob the page ships: the classic __NEXT_DATA__ plus any <script> whose text
// looks like data (App Router streams JSON via self.__next_f.push([...]) chunks).
function embeddedJson(): unknown[] {
  const blobs: unknown[] = [];
  const nd = document.getElementById("__NEXT_DATA__")?.textContent;
  if (nd) try { blobs.push(JSON.parse(nd)); } catch { /* ignore */ }
  for (const s of document.querySelectorAll("script")) {
    const t = s.textContent || "";
    if (!/filament|colou?r|\/models\//i.test(t)) continue;
    // Pull JSON.parse("...") / push([...]) payloads out of flight chunks and parse what we can.
    for (const m of t.matchAll(/JSON\.parse\((`|'|")((?:\\.|(?!\1).)*)\1\)/g)) {
      try { blobs.push(JSON.parse(JSON.parse(m[1] + m[2] + m[1]))); } catch { /* ignore */ }
    }
    if (blobs.length === 0 && /^\s*[[{]/.test(t)) try { blobs.push(JSON.parse(t)); } catch { /* ignore */ }
  }
  return blobs;
}

// Walk parsed JSON for objects that carry a model id we have a card for; return id → that object.
function findModels(blobs: unknown[], ids: Set<string>): Map<string, Record<string, unknown>> {
  const found = new Map<string, Record<string, unknown>>();
  const seen = new WeakSet<object>();
  const stack: unknown[] = [...blobs];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node as object)) continue;
    seen.add(node as object);
    const o = node as Record<string, unknown>;
    for (const key of ["id", "designId", "modelId", "design_id"]) {
      const v = o[key];
      if (v != null && ids.has(String(v)) && !found.has(String(v))) found.set(String(v), o);
    }
    for (const k in o) { const v = o[k]; if (v && typeof v === "object") stack.push(v); }
  }
  return found;
}

// Distinct filament colours declared anywhere inside a model object (its filament/colour fields hold hex
// strings). Counting distinct hexes within one model object is robust to whatever the exact field is named.
function colourCount(model: Record<string, unknown>): number {
  const hexes = new Set<string>();
  const json = JSON.stringify(model);
  for (const m of json.matchAll(HEX)) hexes.add(m[0].replace(/^#/, "").toLowerCase());
  return hexes.size;
}

function badge(card: HTMLElement, n: number): void {
  let b = card.querySelector<HTMLElement>(".bd-colorbadge");
  if (!b) {
    b = document.createElement("div");
    b.className = "bd-colorbadge";
    Object.assign(b.style, {
      position: "absolute", top: "6px", left: "6px", zIndex: "20", pointerEvents: "none",
      font: "600 11px/1 system-ui,sans-serif", color: "#fff", padding: "3px 6px", borderRadius: "999px",
      background: "rgba(15,23,42,0.85)", border: "1px solid rgba(255,255,255,0.25)",
    });
    if (getComputedStyle(card).position === "static") card.style.position = "relative";
    card.appendChild(b);
  }
  b.textContent = `🎨 ${n}`;
}

let minColours = 5;
let filterOn = false;
const countOf = new Map<string, number>(); // model id → colour count (cached)

function apply(): void {
  const cards = pageCards();
  const unknown = [...cards.keys()].filter((id) => !countOf.has(id));
  if (unknown.length) {
    const models = findModels(embeddedJson(), new Set(unknown));
    for (const id of unknown) {
      const m = models.get(id);
      if (m) countOf.set(id, colourCount(m));
    }
    if (DEBUG) {
      const first = models.get(unknown[0]);
      console.log(`[BedReady] ${cards.size} cards · ${unknown.length} unknown · ${models.size} matched in embedded JSON`);
      if (first) {
        // Dump promising nested fields, then the whole object (truncated), so the colour data can be located.
        for (const k of ["designExtension", "ext", "preset", "bomsNeeded", "modelSource", "designType"]) {
          if (k in first) console.log(`[BedReady] ${k} = ${JSON.stringify((first as Record<string, unknown>)[k]).slice(0, 400)}`);
        }
        console.log(`[BedReady] FULL model ${unknown[0]} (first 4000 chars):\n${JSON.stringify(first).slice(0, 4000)}`);
      } else {
        console.log(`[BedReady] no model objects matched — __NEXT_DATA__ present: ${!!document.getElementById("__NEXT_DATA__")}, scripts: ${document.querySelectorAll("script").length}`);
      }
    }
  }
  for (const [id, card] of cards) {
    const n = countOf.get(id);
    if (n != null && n >= 2) badge(card, n);
    card.style.transition = "opacity .15s";
    card.style.opacity = filterOn && (n ?? 0) < minColours ? "0.15" : "";
  }
}

function controlBar(): void {
  if (document.getElementById("bd-color-bar")) return;
  const bar = document.createElement("div");
  bar.id = "bd-color-bar";
  Object.assign(bar.style, {
    position: "fixed", bottom: "16px", right: "16px", zIndex: "2147483000",
    display: "flex", alignItems: "center", gap: "8px", font: "13px/1 system-ui,sans-serif", color: "#e2e8f0",
    background: "#0f172a", border: "1px solid #334155", borderRadius: "999px", padding: "8px 12px",
    boxShadow: "0 8px 28px rgba(0,0,0,.4)",
  });
  const label = document.createElement("span");
  label.textContent = "🎨 min colors";
  const input = document.createElement("input");
  input.type = "number";
  input.min = "2";
  input.value = String(minColours);
  Object.assign(input.style, { width: "44px", background: "#1e293b", color: "#fff", border: "1px solid #334155", borderRadius: "6px", padding: "3px 5px", font: "inherit" });
  const toggle = document.createElement("button");
  const paint = () => { toggle.textContent = filterOn ? "Filtering ✓" : "Filter"; toggle.style.background = filterOn ? "#16a34a" : "#f97316"; };
  Object.assign(toggle.style, { border: "0", color: "#fff", borderRadius: "999px", padding: "4px 10px", cursor: "pointer", font: "600 12px system-ui" });
  input.addEventListener("input", () => { minColours = Math.max(2, parseInt(input.value, 10) || 5); apply(); });
  toggle.addEventListener("click", () => { filterOn = !filterOn; paint(); apply(); });
  paint();
  bar.append(label, input, toggle);
  (document.body || document.documentElement).appendChild(bar);
}

export function initMakerWorldColors(): void {
  if (!/(^|\.)makerworld\.com$/.test(location.hostname)) return;
  const run = () => { controlBar(); apply(); };
  run();
  let t: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => { clearTimeout(t); t = setTimeout(run, 400); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", schedule);
}
