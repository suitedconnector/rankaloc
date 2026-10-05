// Google Places API (New) Text Search, plain fetch. Used only by the "Find business" lookup.
//   POST https://places.googleapis.com/v1/places:searchText
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
//       https://developers.google.com/maps/billing-and-pricing/sku-details

import { LANGUAGE_CODE } from "./config";
import type { Business, Env } from "./types";

const URL_SEARCH_TEXT = "https://places.googleapis.com/v1/places:searchText";

// The field mask is required (no default). Each field and the SKU it triggers:
//   places.id               Text Search Essentials (IDs Only)
//   places.displayName      Text Search Pro
//   places.formattedAddress Text Search Pro
//   places.location         Text Search Pro
// A request is billed at the highest SKU among its fields, so this mask bills as Pro.
const FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location";

export class PlacesError extends Error {}

interface PlacesResponse {
  places?: { id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }[];
  error?: { code?: number; status?: string; message?: string };
}

export interface PlacesLookup {
  businesses: Omit<Business, "confirmedAt">[];
}

/** One Text Search request: `textQuery` is "<name> in <city>". Returns up to `pageSize` matches. */
export async function lookupBusiness(env: Env, name: string, city: string): Promise<PlacesLookup> {
  let res: Response;
  try {
    res = await fetch(URL_SEARCH_TEXT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: `${name} in ${city}`, languageCode: LANGUAGE_CODE, pageSize: 10 }),
    });
  } catch {
    throw new PlacesError("Could not reach Google Places.");
  }

  let body: PlacesResponse | null = null;
  try {
    body = (await res.json()) as PlacesResponse;
  } catch {
    // handled below
  }
  if (!res.ok) {
    // The key is only ever sent as a header, so Google's message cannot contain it.
    const status = body?.error?.status ?? `HTTP ${res.status}`;
    throw new PlacesError(`Google Places error ${status}: ${body?.error?.message ?? "no message returned"}`);
  }
  if (!body) throw new PlacesError("Google Places returned a response that is not JSON.");

  const businesses: PlacesLookup["businesses"] = [];
  for (const p of body.places ?? []) {
    if (!p.id) continue;
    const b: PlacesLookup["businesses"][number] = {
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? "",
      placeId: p.id,
    };
    if (typeof p.location?.latitude === "number" && typeof p.location.longitude === "number") {
      b.lat = p.location.latitude;
      b.lng = p.location.longitude;
    }
    businesses.push(b);
  }
  return { businesses };
}
