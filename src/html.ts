import { DEFAULT_ZOOM, GRID_SIZE, MAX_ZOOM, MIN_ZOOM, SPACING_MILES } from "./config";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const page = (title: string, body: string, extraCss = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}
  label{display:block;margin-top:1rem;font-weight:600}
  input{width:100%;padding:.5rem;font:inherit;box-sizing:border-box}
  small{color:#555;font-weight:400}
  button{margin-top:1.25rem;padding:.6rem 1.2rem;font:inherit}
  .err{background:#fde8e8;border:1px solid #e0a0a0;padding:.5rem 1rem;margin:1rem 0}
  pre{background:#f4f4f4;padding:1rem;overflow:auto;font-size:.8rem}
${extraCss}</style></head><body>${body}</body></html>`;

export interface FormValues {
  placeId?: string;
  keyword?: string;
  center?: string;
  zoom?: string;
}

export function formPage(values: FormValues = {}, errors: string[] = []): string {
  const errBlock = errors.length
    ? `<div class="err" role="alert"><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`
    : "";
  return page(
    "Rank grid scan",
    `<h1>Rank grid scan</h1>
<p>Runs one ${GRID_SIZE}x${GRID_SIZE} Google Maps scan, ${SPACING_MILES} mile between points.</p>
${errBlock}
<section class="find" aria-labelledby="find-h">
  <h2 id="find-h">Find business</h2>
  <p class="hint">Look up the Place ID by name instead of pasting it (Google Places search).</p>
  <label for="biz-name">Business name</label>
  <input id="biz-name" autocomplete="off">
  <label for="biz-city">City <small>(e.g. Pasadena, CA)</small></label>
  <input id="biz-city" autocomplete="off" placeholder="Pasadena, CA">
  <button type="button" id="biz-find">Find</button>
  <p id="biz-status" role="status" aria-live="polite"></p>
  <ul id="biz-results" class="results"></ul>
  <label for="biz-saved">Previously confirmed businesses</label>
  <select id="biz-saved"><option value="">Choose a saved business...</option></select>
</section>
<form method="post" action="/scan">
  <label for="placeId">Place ID <small>(Google Place ID of the business)</small></label>
  <input id="placeId" name="placeId" required value="${esc(values.placeId ?? "")}">
  <label for="keyword">Keyword</label>
  <input id="keyword" name="keyword" required value="${esc(values.keyword ?? "")}">
  <label for="center">Center coordinates <small>(latitude,longitude)</small></label>
  <input id="center" name="center" required placeholder="34.147136,-118.068936" value="${esc(values.center ?? "")}">
  <label for="zoom">Zoom <small>(optional, ${MIN_ZOOM}-${MAX_ZOOM}, default ${DEFAULT_ZOOM})</small></label>
  <input id="zoom" name="zoom" inputmode="numeric" value="${esc(values.zoom ?? "")}">
  <button type="submit">Start scan</button>
</form>
<script>
const $ = (n) => document.getElementById(n);
let saved = [];

function setStatus(text, isError) {
  const el = $("biz-status");
  el.textContent = text;
  el.className = isError ? "bad" : "";
}

function fillCenter(b) {
  if (typeof b.lat !== "number" || typeof b.lng !== "number") return false;
  $("center").value = b.lat + "," + b.lng; // stays editable
  return true;
}

function useBusiness(b, label) {
  $("placeId").value = b.placeId;
  const centered = fillCenter(b);
  setStatus(label + ": Place ID set to " + b.placeId + " (" + (b.name || "unnamed") + ")." + (centered ? " Center filled in." : ""), false);
}

function renderSaved() {
  const sel = $("biz-saved");
  sel.replaceChildren(new Option("Choose a saved business...", ""));
  for (const b of saved) sel.add(new Option((b.name || b.placeId) + (b.address ? " - " + b.address : ""), b.placeId));
}

async function loadSaved() {
  try {
    const res = await fetch("/businesses");
    saved = (await res.json()).businesses || [];
    renderSaved();
  } catch (e) { /* the dropdown just stays empty */ }
}

async function confirmBusiness(b) {
  $("placeId").value = b.placeId; // always fill the field, even if saving fails
  const centered = fillCenter(b);
  try {
    const res = await fetch("/business", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
    });
    if (!res.ok) throw new Error((await res.json()).error || "HTTP " + res.status);
    setStatus("Confirmed and saved: " + (b.name || b.placeId) + ". Place ID" + (centered ? " and center" : "") + " filled in below.", false);
    await loadSaved();
  } catch (e) {
    setStatus("Place ID" + (centered ? " and center" : "") + " filled in, but it could not be saved: " + e.message, true);
  }
}

function showResults(businesses) {
  const ul = $("biz-results");
  ul.replaceChildren();
  for (const b of businesses) {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = b.name || "(no name returned)";
    const lines = [b.address || "(no address returned)", "place_id: " + b.placeId];
    if (typeof b.lat === "number" && typeof b.lng === "number") lines.push("center: " + b.lat + "," + b.lng);
    li.append(title);
    for (const t of lines) { const d = document.createElement("div"); d.textContent = t; li.append(d); }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Use this business";
    btn.addEventListener("click", () => confirmBusiness(b));
    li.append(btn);
    ul.append(li);
  }
}

async function find() {
  const btn = $("biz-find");
  $("biz-results").replaceChildren();
  btn.disabled = true; // one click = one billable request
  setStatus("Looking up...", false);
  try {
    const res = await fetch("/lookup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: $("biz-name").value, location: $("biz-city").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    if (!data.businesses.length) {
      setStatus("No business found for that name and city. Check the spelling, or paste a Place ID below.", true);
    } else {
      setStatus((data.businesses.length === 1 ? "Found 1 business." : "Found " + data.businesses.length + " businesses.") +
        " Confirm it to fill the Place ID.", false);
      showResults(data.businesses);
    }
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

$("biz-find").addEventListener("click", find);
for (const id of ["biz-name", "biz-city"]) {
  $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); find(); } });
}
$("biz-saved").addEventListener("change", (e) => {
  const b = saved.find((x) => x.placeId === e.target.value);
  if (b) useBusiness(b, "Saved business");
});
loadSaved();
</script>`,
    `
  :root{color-scheme:light}body{background:#fff;color:#111}
  .find{border:1px solid #ccc;border-radius:.5rem;padding:0 1rem 1rem;margin:1rem 0}
  .find h2{margin:.8rem 0 .2rem;font-size:1.1rem}
  .hint{margin:0;color:#555;font-size:.9rem}
  select{width:100%;padding:.5rem;font:inherit;box-sizing:border-box}
  #biz-status{margin:.75rem 0 0;font-weight:600}#biz-status.bad{color:#b02a1f}
  .results{list-style:none;padding:0;margin:.5rem 0 0}
  .results li{border:1px solid #ccc;border-radius:.4rem;padding:.6rem .8rem;margin-top:.5rem;overflow-wrap:anywhere}
  .results button{margin-top:.5rem}`,
  );
}

/**
 * Shown after a scan is started. Re-reads /scan/:id every 10 seconds (that request also
 * advances the scan) and draws a progress bar plus the grid, until the scan is complete.
 */
export function startedPage(scanId: string): string {
  const css = `
  :root{color-scheme:light}body{background:#fff;color:#111}
  .meta{display:grid;grid-template-columns:max-content 1fr;gap:.2rem 1rem;margin:1rem 0}
  .meta dt{font-weight:600}.meta dd{margin:0;overflow-wrap:anywhere}
  .bar{height:1rem;background:#e3e3e3;border-radius:.5rem;overflow:hidden;margin-top:1rem}
  .bar>div{height:100%;width:0;background:#2b7a3d;transition:width .4s}
  #status{margin:.5rem 0 1rem;font-weight:600}
  #grid{display:grid;grid-template-columns:repeat(5,1fr);gap:.4rem;margin:1rem 0}
  .cell{aspect-ratio:1;display:flex;align-items:center;justify-content:center;text-align:center;
    border-radius:.4rem;font-weight:700;font-size:1.1rem;line-height:1.1;padding:.2rem;color:#fff;background:#8a8a8a}
  .cell.pending{background:#9a9a9a;animation:pulse 1.4s ease-in-out infinite}
  .cell.r-top{background:#2b7a3d}.cell.r-mid{background:#b8860b}.cell.r-low{background:#c2570c}
  .cell.none{background:#fff;color:#444;border:2px solid #999;font-size:.8rem;font-weight:600}
  .cell.error{background:#c0392b;font-size:.8rem}
  .legend{font-size:.85rem;color:#555}
  @keyframes pulse{50%{opacity:.45}}
  @media (prefers-reduced-motion:reduce){.cell.pending{animation:none}}`;
  return page(
    "Scan progress",
    `<h1>Rank grid scan</h1>
<dl class="meta">
  <dt>Keyword</dt><dd id="m-keyword">Loading...</dd>
  <dt>Place ID</dt><dd id="m-place"></dd>
  <dt>Center</dt><dd id="m-center"></dd>
  <dt>Zoom</dt><dd id="m-zoom"></dd>
  <dt>Language</dt><dd id="m-lang"></dd>
  <dt>Cost</dt><dd id="m-cost"></dd>
</dl>
<div class="bar" role="progressbar" aria-label="Points ready" aria-valuemin="0" aria-valuemax="25" aria-valuenow="0"><div id="fill"></div></div>
<p id="status">Waiting for the first check...</p>
<p id="warn" class="err" role="alert" hidden></p>
<div id="grid" aria-label="Rank at each grid point, north at top"></div>
<p class="legend">North is up. Standard queue results take up to about 5 minutes; this page checks every 10 seconds.
Rank 1-3 green, 4-10 amber, 11 and up orange. Gray pulsing = waiting for DataForSEO.</p>
<p><a id="raw" href="/scan/${esc(scanId)}">View raw JSON</a></p>
<script>
const id = ${JSON.stringify(scanId)};
const $ = (n) => document.getElementById(n);
const set = (n, text) => { $(n).textContent = text; };

function cellFor(p) {
  const c = document.createElement("div");
  c.className = "cell";
  const where = "Row " + (p.row + 1) + ", column " + (p.col + 1) + " (" + p.lat + ", " + p.lng + ")";
  if (p.state === "pending") {
    c.classList.add("pending");
    c.setAttribute("aria-label", where + ": waiting");
    c.title = where + ": waiting";
  } else if (p.state === "error") {
    c.classList.add("error");
    c.textContent = /timed out/i.test(p.error || "") ? "Timed out" : "Error";
    c.setAttribute("aria-label", where + ": error. " + (p.error || ""));
    c.title = where + ": " + (p.error || "error");
  } else if (p.rank === null) {
    c.classList.add("none");
    c.textContent = "not found";
    c.setAttribute("aria-label", where + ": not found");
    c.title = where + ": not found among " + p.checked + " results";
  } else {
    c.classList.add(p.rank <= 3 ? "r-top" : p.rank <= 10 ? "r-mid" : "r-low");
    c.textContent = String(p.rank);
    c.setAttribute("aria-label", where + ": rank " + p.rank);
    c.title = where + ": rank " + p.rank;
  }
  return c;
}

function render(scan) {
  const i = scan.inputs, pts = scan.points || [];
  set("m-keyword", i.keyword);
  set("m-place", i.placeId);
  set("m-center", i.center.lat + ", " + i.center.lng);
  set("m-zoom", String(i.zoom));
  set("m-lang", i.languageCode);
  set("m-cost", "$" + Number(Number(scan.costUsd).toFixed(4)));

  const total = pts.length;
  const ready = pts.filter((p) => p.state !== "pending").length;
  const failed = pts.filter((p) => p.state === "error").length;
  $("fill").style.width = (total ? (ready / total) * 100 : 0) + "%";
  const bar = document.querySelector(".bar");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(ready));
  set("status", ready + " of " + total + " points ready" + (failed ? " (" + failed + " failed)" : "") +
    (scan.status === "complete" ? " - complete" : ""));

  $("warn").hidden = !scan.lastError;
  set("warn", scan.lastError ? "Problem checking DataForSEO, will retry: " + scan.lastError : "");

  const grid = $("grid");
  const cols = pts.reduce((m, p) => Math.max(m, p.col + 1), 0) || 5;
  grid.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
  grid.replaceChildren(...pts.slice().sort((a, b) => a.row - b.row || a.col - b.col).map(cellFor));
}

async function tick() {
  let scan;
  try {
    const res = await fetch("/scan/" + id, { headers: { Accept: "application/json" } });
    scan = await res.json();
    if (!res.ok || !scan.points) throw new Error(scan.error || "HTTP " + res.status);
  } catch (e) {
    set("status", "Check failed, retrying: " + e.message);
    return setTimeout(tick, 10000);
  }
  render(scan);
  if (scan.status !== "complete") setTimeout(tick, 10000);
}
tick();
</script>`,
    css,
  );
}

export function errorPage(title: string, message: string): string {
  return page(title, `<h1>${esc(title)}</h1><div class="err" role="alert">${esc(message)}</div><p><a href="/">Back</a></p>`);
}
