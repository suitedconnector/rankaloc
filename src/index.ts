import {
  CONCURRENCY,
  DEFAULT_ZOOM,
  LANGUAGE_CODE,
  MAX_TASKS_PER_POST,
  MAX_WAIT_MS,
  MAX_ZOOM,
  MIN_ZOOM,
  POLL_MIN_INTERVAL_MS,
} from "./config";
import { DfsError, getTask, postTasks, taskBody } from "./dataforseo";
import type { PostedTask } from "./dataforseo";
import { buildGrid } from "./grid";
import { errorPage, formPage, startedPage } from "./html";
import { PlacesError, lookupBusiness } from "./places";
import type { Business, Env, Scan, ScanPoint } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const scanKey = (id: string) => `scan:${id}`;
const businessKey = (placeId: string) => `business:${placeId}`;

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/") {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return html(formPage());
    }
    if (pathname === "/scan") {
      if (request.method !== "POST") return methodNotAllowed("POST");
      return startScan(request, env);
    }
    if (pathname === "/lookup") {
      if (request.method !== "POST") return methodNotAllowed("POST");
      return lookup(request, env);
    }
    if (pathname === "/business") {
      if (request.method !== "POST") return methodNotAllowed("POST");
      return saveBusiness(request, env);
    }
    if (pathname === "/businesses") {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return listBusinesses(env);
    }
    const match = pathname.match(/^\/scan\/([^/]+)$/);
    if (match) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return getScan(match[1], env);
    }
    return json({ error: "Not found" }, 404);
  },
};

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed", { status: 405, headers: { Allow: allow } });
}

// ---------------------------------------------------------------- start a scan

function parseCenter(raw: string): { lat: number; lng: number } | null {
  const m = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  // Latitude is capped at 85 so the longitude step (divided by cos(lat)) stays sane.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

async function startScan(request: Request, env: Env): Promise<Response> {
  const missing = (["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"] as const).filter((k) => !env[k]);
  if (missing.length) {
    return html(errorPage("Not configured", `Missing Worker secret(s): ${missing.join(", ")}. See the README.`), 500);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return html(errorPage("Bad request", "Submit the form on the home page."), 400);
  }
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const values = { placeId: field("placeId"), keyword: field("keyword"), center: field("center"), zoom: field("zoom") };

  const errors: string[] = [];
  if (!values.placeId) errors.push("Place ID is required.");
  else if (values.placeId.length > 300) errors.push("Place ID is too long.");
  if (!values.keyword) errors.push("Keyword is required.");
  else if (values.keyword.length > 700) errors.push("Keyword must be 700 characters or fewer.");

  const center = values.center ? parseCenter(values.center) : null;
  if (!values.center) errors.push("Center coordinates are required.");
  else if (!center) errors.push('Center coordinates must be "latitude,longitude", latitude within +/-85 and longitude within +/-180.');

  let zoom = DEFAULT_ZOOM;
  if (values.zoom) {
    zoom = Number(values.zoom);
    if (!Number.isInteger(zoom) || zoom < MIN_ZOOM || zoom > MAX_ZOOM) {
      errors.push(`Zoom must be a whole number from ${MIN_ZOOM} to ${MAX_ZOOM}.`);
    }
  }
  if (errors.length || !center) return html(formPage(values, errors), 400);

  const scanId = crypto.randomUUID();
  const grid = buildGrid(center.lat, center.lng);
  const bodies = grid.map((p) => taskBody(values.keyword, p.lat, p.lng, zoom, scanId));

  // One task per grid point, batched within the documented limit of 100 tasks per POST.
  const posted: PostedTask[] = [];
  let costUsd = 0;
  try {
    for (let i = 0; i < bodies.length; i += MAX_TASKS_PER_POST) {
      const res = await postTasks(env, bodies.slice(i, i + MAX_TASKS_PER_POST));
      posted.push(...res.posted);
      costUsd += res.cost;
    }
  } catch (err) {
    // If a later batch fails, earlier tasks are already created (and billed) at DataForSEO
    // but not stored here. With 25 points there is only ever one batch.
    const message = err instanceof DfsError ? err.message : "Could not reach DataForSEO.";
    return html(errorPage("DataForSEO error", message), 502);
  }

  if (posted.every((p) => p.taskId === null)) {
    return html(errorPage("DataForSEO error", posted[0]?.error ?? "No tasks were created."), 502);
  }

  const points: ScanPoint[] = grid.map((p, i) => ({
    ...p,
    rank: null,
    state: posted[i].taskId ? "pending" : "error",
    taskId: posted[i].taskId,
    checked: null,
    error: posted[i].error,
  }));
  const scan: Scan = {
    id: scanId,
    timestamp: new Date().toISOString(),
    status: points.some((p) => p.state === "pending") ? "pending" : "complete",
    inputs: {
      placeId: values.placeId,
      keyword: values.keyword,
      center,
      zoom,
      languageCode: LANGUAGE_CODE,
    },
    points,
    costUsd,
    lastPolledAt: null,
    lastError: null,
  };
  await env.SCANS.put(scanKey(scanId), JSON.stringify(scan));
  return html(startedPage(scanId), 202);
}

// ------------------------------------------------------------ read / advance a scan

async function getScan(id: string, env: Env): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: "Not found" }, 404);
  const raw = await env.SCANS.get(scanKey(id));
  if (!raw) return json({ error: "Scan not found" }, 404);

  let scan = JSON.parse(raw) as Scan;
  if (scan.status === "pending") scan = await advance(scan, env);
  return json(scan);
}

/** Runs a small pool of async jobs, at most `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Checks the tasks that are still pending, folds finished ones into the scan and saves it.
 * Polling happens only when someone reads /scan/:id, and at most once per
 * POLL_MIN_INTERVAL_MS, so an open page cannot hammer DataForSEO or the KV write limit
 * (1 write per second per key).
 */
async function advance(scan: Scan, env: Env): Promise<Scan> {
  const now = Date.now();
  if (scan.lastPolledAt && now - Date.parse(scan.lastPolledAt) < POLL_MIN_INTERVAL_MS) return scan;

  const pending = scan.points.filter((p) => p.state === "pending" && p.taskId);
  let lastError: string | null = null;

  if (now - Date.parse(scan.timestamp) > MAX_WAIT_MS) {
    for (const p of pending) {
      p.state = "error";
      p.error = "Timed out waiting for DataForSEO results.";
    }
  } else {
    const results = await pool(pending, CONCURRENCY, (p) => getTask(env, p.taskId as string, scan.inputs.placeId));
    results.forEach((res, i) => {
      const p = pending[i];
      if (res.status === "rejected") {
        // HTTP/API-level problem: leave the point pending and retry on the next poll.
        lastError = res.reason instanceof Error ? res.reason.message : "Unknown polling error.";
        return;
      }
      const poll = res.value;
      if (poll.kind === "done") {
        p.state = "done";
        p.rank = poll.rank;
        p.checked = poll.checked;
        p.error = null;
      } else if (poll.kind === "error") {
        p.state = "error";
        p.error = poll.message;
      }
    });
  }

  scan.lastPolledAt = new Date(now).toISOString();
  scan.lastError = lastError;
  if (!scan.points.some((p) => p.state === "pending")) scan.status = "complete";
  await env.SCANS.put(scanKey(scan.id), JSON.stringify(scan));
  return scan;
}

// ---------------------------------------------------------------- find a business

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * POST /lookup {name, location}: one Places API (New) Text Search request.
 * `location` is free text such as "Pasadena, CA". Responds {businesses} or {error}.
 */
async function lookup(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_PLACES_API_KEY) return json({ error: "Missing Worker secret GOOGLE_PLACES_API_KEY. See the README." }, 500);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Send JSON with a name and a city." }, 400);
  }
  const name = str(body.name);
  const location = str(body.location);

  if (!name) return json({ error: "Enter a business name." }, 400);
  if (!location) return json({ error: "Enter a city." }, 400);
  if (name.length > 300 || location.length > 200) return json({ error: "Business name or city is too long." }, 400);

  try {
    const { businesses } = await lookupBusiness(env, name, location);
    return json({ businesses });
  } catch (err) {
    return json({ error: err instanceof PlacesError ? err.message : "Lookup failed." }, 502);
  }
}

/** POST /business {name, address, placeId, lat?, lng?}: stores a confirmed business as `business:<placeId>`. */
async function saveBusiness(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Send JSON." }, 400);
  }
  const placeId = str(body.placeId);
  if (!placeId || placeId.length > 300) return json({ error: "A place ID is required." }, 400);

  const business: Business = {
    name: str(body.name).slice(0, 300),
    address: str(body.address).slice(0, 300),
    placeId,
    confirmedAt: new Date().toISOString(),
  };
  const { lat, lng } = body;
  if (typeof lat === "number" && typeof lng === "number" && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    business.lat = lat;
    business.lng = lng;
  }
  await env.SCANS.put(businessKey(placeId), JSON.stringify(business));
  return json({ business });
}

/** GET /businesses: previously confirmed businesses, newest first (up to 100). */
async function listBusinesses(env: Env): Promise<Response> {
  const { keys } = await env.SCANS.list({ prefix: "business:", limit: 100 });
  const rows = await Promise.all(keys.map((k) => env.SCANS.get(k.name)));
  const businesses = rows
    .filter((raw): raw is string => raw !== null)
    .map((raw) => JSON.parse(raw) as Business)
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
  return json({ businesses });
}
