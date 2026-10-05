export interface Env {
  SCANS: KVNamespace;
  DATAFORSEO_LOGIN: string;
  DATAFORSEO_PASSWORD: string;
  GOOGLE_PLACES_API_KEY: string;
  /** Optional. Only for pointing the Worker at a mock server while testing. */
  DATAFORSEO_BASE_URL?: string;
}

export interface GridPoint {
  row: number; // 0 = northernmost row
  col: number; // 0 = westernmost column
  lat: number;
  lng: number;
}

export type PointState = "pending" | "done" | "error";

export interface ScanPoint extends GridPoint {
  /** Rank of the place ID in this point's results, or null if not found. */
  rank: number | null;
  state: PointState;
  taskId: string | null;
  /** How many maps_search results were checked at this point. */
  checked: number | null;
  error: string | null;
}

export interface ScanInputs {
  placeId: string;
  keyword: string;
  center: { lat: number; lng: number };
  zoom: number;
  languageCode: string;
}

export interface Scan {
  id: string;
  timestamp: string; // ISO 8601, when the scan was started
  status: "pending" | "complete";
  inputs: ScanInputs;
  points: ScanPoint[];
  /** Sum of the `cost` (USD) DataForSEO returned for the task_post calls. */
  costUsd: number;
  lastPolledAt: string | null;
  /** Last transient problem while polling (HTTP/API-level), cleared on a clean poll. */
  lastError: string | null;
}

/** A business the user confirmed through "Find business". Stored in KV as `business:<placeId>`. */
export interface Business {
  name: string;
  address: string;
  placeId: string;
  /** Place location from Places Text Search; absent on businesses saved before it was requested. */
  lat?: number;
  lng?: number;
  /** Only on businesses saved when "Find business" used DataForSEO. */
  cid?: string;
  confirmedAt: string; // ISO 8601
}
