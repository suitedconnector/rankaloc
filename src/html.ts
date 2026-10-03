import { DEFAULT_ZOOM, GRID_SIZE, MAX_ZOOM, MIN_ZOOM, SPACING_MILES } from "./config";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const page = (title: string, body: string) => `<!doctype html>
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
</style></head><body>${body}</body></html>`;

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
</form>`,
  );
}

/** Shown after a scan is started. Polls /scan/:id (which advances the scan) until complete. */
export function startedPage(scanId: string): string {
  return page(
    "Scan started",
    `<h1>Scan started</h1>
<p>Scan <code>${esc(scanId)}</code>. Standard queue results take up to about 5 minutes.
This page checks every 10 seconds. The stored JSON is at <a href="/scan/${esc(scanId)}">/scan/${esc(scanId)}</a>.</p>
<p id="progress">Waiting for the first check...</p>
<pre id="out"></pre>
<script>
const id = ${JSON.stringify(scanId)};
async function tick() {
  let scan;
  try {
    const res = await fetch("/scan/" + id, { headers: { Accept: "application/json" } });
    scan = await res.json();
  } catch (e) {
    document.getElementById("progress").textContent = "Check failed, retrying: " + e;
    return setTimeout(tick, 10000);
  }
  const pts = scan.points || [];
  const open = pts.filter(p => p.state === "pending").length;
  document.getElementById("progress").textContent =
    scan.status === "complete" ? "Complete." : (pts.length - open) + " of " + pts.length + " points ready.";
  document.getElementById("out").textContent = JSON.stringify(scan, null, 2);
  if (scan.status !== "complete") setTimeout(tick, 10000);
}
tick();
</script>`,
  );
}

export function errorPage(title: string, message: string): string {
  return page(title, `<h1>${esc(title)}</h1><div class="err" role="alert">${esc(message)}</div><p><a href="/">Back</a></p>`);
}
