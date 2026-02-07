/**
 * HTTP helpers — thin wrappers around native fetch for gateway/coordinator.
 */

/** JSON GET request. Throws on non-2xx. */
export async function httpGet<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url} → ${res.status}: ${body}`);
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
