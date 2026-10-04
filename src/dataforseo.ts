// DataForSEO Google Maps SERP, Standard queue, plain fetch.
//   POST {base}/v3/serp/google/maps/task_post
//   GET  {base}/v3/serp/google/maps/task_get/advanced/{id}
// Docs: https://docs.dataforseo.com/v3/serp/google/maps/task_post/
//       https://docs.dataforseo.com/v3/serp/google/maps/task_get/advanced/
//       https://docs.dataforseo.com/v3/business_data/google/my_business_info/live/
//       https://docs.dataforseo.com/v3/appendix/errors/

import { DFS_BASE_URL, LANGUAGE_CODE } from "./config";
import type { Business, Env } from "./types";

/** Status codes from the errors appendix. */
const OK = 20000;
const TASK_CREATED = 20100;
const TASK_HANDED = 40601; // received, not yet enqueued
const TASK_IN_QUEUE = 40602; // enqueued, not ready

export class DfsError extends Error {}

interface DfsEnvelope {
  status_code: number;
  status_message: string;
  cost?: number;
  tasks?: DfsTask[];
}

interface DfsTask {
  id?: string;
  status_code: number;
  status_message: string;
  cost?: number;
  result?: DfsResult[] | null;
}

interface DfsResult {
  items_count?: number;
  items?: DfsItem[] | null;
}

interface DfsItem {
  type?: string; // "maps_search" | "maps_paid_item"
  rank_group?: number;
  rank_absolute?: number;
  place_id?: string;
  title?: string; // My Business Info: business name
  address?: string | null;
  cid?: string | null;
}

export interface TaskBody {
  keyword: string;
  location_coordinate: string; // "latitude,longitude,zoom", zoom with a trailing "z"
  language_code: string;
  search_this_area: boolean;
  tag: string;
}

export interface PostedTask {
  taskId: string | null;
  error: string | null;
}

export type TaskPoll =
  | { kind: "pending" }
  | { kind: "error"; message: string }
  | { kind: "done"; rank: number | null; checked: number };

function headers(env: Env): HeadersInit {
  // Basic Authentication: base64("login:password"). Credentials come from Worker secrets.
  const token = btoa(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`);
  return { Authorization: `Basic ${token}`, "Content-Type": "application/json" };
}

function base(env: Env): string {
  return env.DATAFORSEO_BASE_URL ?? DFS_BASE_URL;
}

async function readEnvelope(res: Response): Promise<DfsEnvelope> {
  if (res.status === 401) {
    throw new DfsError("DataForSEO rejected the credentials (HTTP 401). Check DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD.");
  }
  if (!res.ok) throw new DfsError(`DataForSEO returned HTTP ${res.status}.`);
  let body: DfsEnvelope;
  try {
    body = (await res.json()) as DfsEnvelope;
  } catch {
    throw new DfsError("DataForSEO returned a response that is not JSON.");
  }
  if (body.status_code !== OK) {
    throw new DfsError(`DataForSEO error ${body.status_code}: ${body.status_message}`);
  }
  return body;
}

/** Posts up to 100 tasks in one request. Returns one entry per task, in order, plus the cost. */
export async function postTasks(env: Env, tasks: TaskBody[]): Promise<{ posted: PostedTask[]; cost: number }> {
  const res = await fetch(`${base(env)}/v3/serp/google/maps/task_post`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify(tasks),
  });
  const body = await readEnvelope(res);
  const returned = body.tasks ?? [];
  if (returned.length !== tasks.length) {
    throw new DfsError(`DataForSEO returned ${returned.length} tasks for ${tasks.length} posted.`);
  }
  const posted = returned.map((t): PostedTask =>
    t.status_code === TASK_CREATED && t.id
      ? { taskId: t.id, error: null }
      : { taskId: null, error: `DataForSEO ${t.status_code}: ${t.status_message}` },
  );
  return { posted, cost: body.cost ?? 0 };
}

export function taskBody(keyword: string, lat: number, lng: number, zoom: number, tag: string): TaskBody {
  return {
    keyword,
    location_coordinate: `${lat},${lng},${zoom}z`,
    language_code: LANGUAGE_CODE,
    // Documented default is true. Stated explicitly: each point searches only the map
    // area around its own coordinates, like pressing "Search this area" in Google Maps.
    search_this_area: true,
    tag,
  };
}

/** One task_get call. Throws DfsError for HTTP/API-level problems that should be retried. */
export async function getTask(env: Env, taskId: string, placeId: string): Promise<TaskPoll> {
  const res = await fetch(`${base(env)}/v3/serp/google/maps/task_get/advanced/${encodeURIComponent(taskId)}`, {
    headers: headers(env),
  });
  const body = await readEnvelope(res);
  const task = body.tasks?.[0];
  if (!task) throw new DfsError("DataForSEO response had no task entry.");

  if (task.status_code === TASK_HANDED || task.status_code === TASK_IN_QUEUE) return { kind: "pending" };
  if (task.status_code !== OK) {
    return { kind: "error", message: `DataForSEO ${task.status_code}: ${task.status_message}` };
  }

  // Rank = rank_group of the maps_search item whose place_id matches. rank_group counts
  // only items of the same type, so paid items (maps_paid_item) do not shift the rank.
  // rank_absolute would count every element in the SERP.
  const items = task.result?.[0]?.items ?? [];
  let checked = 0;
  let rank: number | null = null;
  for (const item of items) {
    if (item.type !== "maps_search") continue;
    checked++;
    if (rank === null && item.place_id === placeId && typeof item.rank_group === "number") {
      rank = item.rank_group;
    }
  }
  return { kind: "done", rank, checked };
}

export interface BusinessLookup {
  businesses: Omit<Business, "confirmedAt">[];
  /** USD charged for the lookup, from the response `cost` field (null if absent). */
  costUsd: number | null;
}

/**
 * One My Business Info Live request. `keyword` is the business name only; the city goes in
 * `location_name` ("City,State,Country"), which the docs require when no location_code or
 * location_coordinate is sent. The docs say each result holds a single business, but every
 * item found in every result is returned so a list works too.
 */
export async function lookupBusiness(env: Env, name: string, locationName: string): Promise<BusinessLookup> {
  const res = await fetch(`${base(env)}/v3/business_data/google/my_business_info/live`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify([{ keyword: name, location_name: locationName, language_code: LANGUAGE_CODE }]),
  });
  const body = await readEnvelope(res);
  const task = body.tasks?.[0];
  if (!task) throw new DfsError("DataForSEO response had no task entry.");
  if (task.status_code !== OK) throw new DfsError(`DataForSEO ${task.status_code}: ${task.status_message}`);

  const businesses: BusinessLookup["businesses"] = [];
  for (const result of task.result ?? []) {
    for (const item of result.items ?? []) {
      if (!item.place_id) continue;
      businesses.push({
        name: item.title ?? "",
        address: item.address ?? "",
        placeId: item.place_id,
        cid: item.cid ?? "",
      });
    }
  }
  return { businesses, costUsd: typeof body.cost === "number" ? body.cost : (task.cost ?? null) };
}
