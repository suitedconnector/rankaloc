// DataForSEO Google Maps SERP, Standard queue, plain fetch.
//   POST {base}/v3/serp/google/maps/task_post
//   GET  {base}/v3/serp/google/maps/task_get/advanced/{id}
// Docs: https://docs.dataforseo.com/v3/serp/google/maps/task_post/
//       https://docs.dataforseo.com/v3/serp/google/maps/task_get/advanced/
//       https://docs.dataforseo.com/v3/appendix/errors/

import { DFS_BASE_URL, LANGUAGE_CODE } from "./config";
import type { Competitor, Env } from "./types";

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
  title?: string | null;
  cid?: string | null;
  category?: string | null;
  rating?: { value?: number | null; votes_count?: number | null } | null;
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
  | { kind: "done"; rank: number | null; checked: number; results: Competitor[] };

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
  const results: Competitor[] = [];
  for (const item of items) {
    if (item.type !== "maps_search") continue;
    checked++;
    results.push(...competitorOf(item));
    if (rank === null && item.place_id === placeId && typeof item.rank_group === "number") {
      rank = item.rank_group;
    }
  }
  return { kind: "done", rank, checked, results };
}

/** The stored fields of one maps_search item. Items without a place_id or rank_group are skipped. */
function competitorOf(item: DfsItem): Competitor[] {
  if (!item.place_id || typeof item.rank_group !== "number") return [];
  const c: Competitor = { name: (item.title ?? "").slice(0, 150), placeId: item.place_id, rank: item.rank_group };
  if (item.cid) c.cid = item.cid;
  if (typeof item.rating?.value === "number") c.rating = item.rating.value;
  if (typeof item.rating?.votes_count === "number") c.votes = item.rating.votes_count;
  if (item.category) c.category = item.category.slice(0, 80);
  return [c];
}
