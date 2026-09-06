const KEY = "ppm-last-local-url";

/**
 * The LAN URL of this PPM server, remembered from the last time the API
 * answered. When the public hostname stops responding, the API is exactly what
 * we cannot ask any more — so the offline overlay reads this to offer a way
 * back in. Persisted (not just in-memory) so it survives the reload a user
 * naturally tries first.
 */
export function rememberLocalUrl(url: string | null): void {
  try {
    if (url) localStorage.setItem(KEY, url);
  } catch { /* private mode / storage full — the overlay just omits the link */ }
}

export function getLastKnownLocalUrl(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && /^https?:\/\//.test(v) ? v : null;
  } catch {
    return null;
  }
}
