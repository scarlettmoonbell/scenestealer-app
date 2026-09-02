import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface VideoMetadata {
  recordedAt: Date | null;
  deviceModel: string | null;
  gpsLat: number | null;
  gpsLon: number | null;
}

// ISO 6709 (QuickTime's location tag shape, e.g. "+30.2672-097.7431+165.000/")
// — sign+lat, sign+lon, optional altitude, trailing slash. Confirmed
// against a real ffprobe readback of a file carrying this exact tag
// before writing this regex, not assumed from the spec alone.
const ISO6709_RE = /^([+-]\d+\.\d+)([+-]\d+\.\d+)/;

/**
 * Reads whatever metadata tags the file happens to carry — most
 * uploads won't have all of these, some (e.g. screen recordings,
 * exports from editing software) will have none. Never throws for a
 * missing tag; only a genuine ffprobe failure (corrupt file, ffprobe
 * not on PATH) propagates.
 */
export async function extractVideoMetadata(
  videoPath: string,
): Promise<VideoMetadata> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    videoPath,
  ]);

  const tags = (JSON.parse(stdout).format?.tags ?? {}) as Record<
    string,
    string
  >;

  // A single upstream ffmpeg encode has been observed to emit this
  // semicolon-joined if creation_time is set both explicitly and by the
  // muxer itself — defensive split even though a genuine phone-recorded
  // file (written once by the camera, not re-muxed) shouldn't need it.
  const rawCreationTime = tags["creation_time"]?.split(";")[0];
  const recordedAt = rawCreationTime ? new Date(rawCreationTime) : null;

  const deviceModel = tags["com.apple.quicktime.model"] ?? null;

  const locationTag = tags["com.apple.quicktime.location.ISO6709"];
  const match = locationTag?.match(ISO6709_RE);
  const gpsLat = match ? parseFloat(match[1]) : null;
  const gpsLon = match ? parseFloat(match[2]) : null;

  return {
    recordedAt: recordedAt && !isNaN(recordedAt.getTime()) ? recordedAt : null,
    deviceModel,
    gpsLat,
    gpsLon,
  };
}

export interface GeocodeResult {
  venue: string | null;
  city: string | null;
}

// Business/POI categories Nominatim can return — venue only gets
// populated when the coordinate resolves to one of these, never a bare
// residential address. Confirmed against real reverse-geocode calls:
// an office building returned category "office" with a real business
// name; a residential address returned category "building" with an
// empty name — exactly the split this whitelist is built to make.
const VENUE_CATEGORIES = new Set([
  "amenity",
  "shop",
  "tourism",
  "leisure",
  "office",
]);

interface NominatimReverseResponse {
  category?: string;
  name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
  };
}

/**
 * OpenStreetMap Nominatim — free, no API key, alpha-phase choice (see
 * ROADMAP.md for the beta-phase re-evaluation trigger: rate-limiting
 * pressure at real tenant volume against Nominatim's ~1 req/sec usage
 * policy, which a per-video, once-at-analyze-time call comfortably
 * stays under). Best-effort: any failure returns nulls rather than
 * failing the analyze job over a geocoding hiccup.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<GeocodeResult> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&addressdetails=1&namedetails=1`;
    const res = await fetch(url, {
      headers: {
        // Required by Nominatim's usage policy — identifies the
        // application making requests, not shown to end users.
        "User-Agent": "SceneStealer/1.0 (support@scenestealer.app)",
      },
    });
    if (!res.ok) return { venue: null, city: null };

    const data = (await res.json()) as NominatimReverseResponse;
    const city =
      data.address?.city ??
      data.address?.town ??
      data.address?.village ??
      data.address?.county ??
      null;
    const venue =
      data.category && VENUE_CATEGORIES.has(data.category) && data.name
        ? data.name
        : null;

    return { venue, city };
  } catch {
    return { venue: null, city: null };
  }
}
