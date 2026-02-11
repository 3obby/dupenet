/**
 * HTTP helpers — thin wrappers around native fetch for gateway/coordinator.
 *
 * Multi-endpoint support:
 *   fetchWithRotation() tries each base URL in order, rotating on network
 *   errors (connection refused, timeout, DNS failure). 4xx/5xx responses
 *   from a reachable server are NOT retried (the request was delivered).
 *   This enables transparent failover when multiple hosts serve the network.
 */

/** Timeout for each individual fetch attempt (ms). */
const FETCH_TIMEOUT_MS = 30_000;

/** Is this an error that means the server is unreachable (worth retrying next endpoint)? */
function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch() network errors are TypeError
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("etimedout") ||
      msg.includes("econnreset") ||
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("abort")
    );
  }
  return false;
}

/**
 * Try a fetch operation against multiple base URLs with rotation.
 * The `buildRequest` callback receives each base URL and should return the
 * full URL + fetch options. On network error, the next endpoint is tried.
 * Non-network errors (4xx, 5xx from a reachable server) are returned as-is.
 */
export async function fetchWithRotation(
  baseUrls: string[],
  buildRequest: (baseUrl: string) => { url: string; init?: RequestInit },
): Promise<Response> {
  if (baseUrls.length === 0) {
    throw new Error("No endpoints configured");
  }

  const errors: Array<{ url: string; error: string }> = [];

  for (const base of baseUrls) {
    const { url, init } = buildRequest(base);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (err) {
      if (isNetworkError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ url, error: msg });
        // Rotate to next endpoint
        continue;
      }
      // Non-network error — propagate immediately
      throw err;
    }
  }

  // All endpoints failed with network errors
  const detail = errors.map((e) => `  ${e.url}: ${e.error}`).join("\n");
  throw new Error(
    `All ${baseUrls.length} endpoint(s) unreachable:\n${detail}`,
  );
}

/** JSON GET request. Throws on non-2xx. */
export async function httpGet<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * JSON GET with multi-endpoint rotation.
 * `path` is appended to each base URL in turn.
 */
export async function httpGetRotate<T>(
  baseUrls: string[],
  path: string,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetchWithRotation(baseUrls, (base) => ({
    url: `${base}${path}`,
    init: { headers },
  }));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/** Binary GET request. Returns raw bytes + response headers. */
export async function httpGetBytes(
  url: string,
  headers?: Record<string, string>,
): Promise<{ bytes: Uint8Array; status: number; headers: Headers; body?: string }> {
  const res = await fetch(url, { headers });
  if (res.status === 402) {
    const body = await res.text();
    return { bytes: new Uint8Array(0), status: 402, headers: res.headers, body };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url} → ${res.status}: ${body}`);
  }
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), status: res.status, headers: res.headers };
}

/**
 * Binary GET with multi-endpoint rotation.
 * Handles 402 (L402 challenge) as a valid response (not retried).
 */
export async function httpGetBytesRotate(
  baseUrls: string[],
  path: string,
  headers?: Record<string, string>,
): Promise<{ bytes: Uint8Array; status: number; headers: Headers; body?: string; usedEndpoint: string }> {
  let usedEndpoint = baseUrls[0] ?? "";

  const res = await fetchWithRotation(baseUrls, (base) => {
    usedEndpoint = base;
    return { url: `${base}${path}`, init: { headers } };
  });

  if (res.status === 402) {
    const body = await res.text();
    return { bytes: new Uint8Array(0), status: 402, headers: res.headers, body, usedEndpoint };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${path} → ${res.status}: ${body}`);
  }
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), status: res.status, headers: res.headers, usedEndpoint };
}

/** JSON POST request. Throws on non-2xx. */
export async function httpPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${url} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * JSON POST with multi-endpoint rotation.
 */
export async function httpPostRotate<T>(
  baseUrls: string[],
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetchWithRotation(baseUrls, (base) => ({
    url: `${base}${path}`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  }));
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Binary PUT request (for blocks). */
export async function httpPutBytes(
  url: string,
  data: Uint8Array,
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: data,
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

/** JSON PUT request (for manifests/assets). */
export async function httpPutJson<T>(
  url: string,
  data: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PUT ${url} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
