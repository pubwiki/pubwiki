/** Common helpers for smoketests (black-box via public wiki HTTP API) */
import { PASSWORD, USERNAME, WIKI_BASE, WIKI_HOST } from "./config.ts";

export async function expectOk(resp: Response): Promise<any> {
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function wikiBase(): string {
  return WIKI_BASE.replace(/\/$/, "");
}

// Minimal cookie jar for Deno fetch
export class CookieJar {
  private jar = new Map<string, string>();
  setFromResponse(resp: Response) {
    const setCookies = resp.headers.getSetCookie?.() ?? resp.headers.get("set-cookie");
    if (!setCookies) return;
    const arr = Array.isArray(setCookies) ? setCookies : [setCookies];
    for (const sc of arr) {
      const pair = sc.split(";", 1)[0];
      const [name, ...rest] = pair.split("=");
      if (!name) continue;
      this.jar.set(name.trim(), rest.join("=").trim());
    }
  }
  header(): string | undefined {
    if (this.jar.size === 0) return undefined;
    return Array.from(this.jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

export async function mwLogin(jar = new CookieJar()): Promise<CookieJar> {
  const host = WIKI_HOST.replace(/\/$/, "");
  // 1. Get login token
  let resp = await fetch(
    `${host}/api.php?action=query&meta=tokens&type=login&format=json`,
    { method: "GET" },
  );
  jar.setFromResponse(resp);
  const tokData = await expectOk(resp);
  const token = tokData?.query?.tokens?.logintoken;
  if (!token) throw new Error("failed to get login token");

  // 2. Post login
  const form = new URLSearchParams();
  form.set("action", "clientlogin");
  form.set("username", USERNAME);
  form.set("password", PASSWORD);
  form.set("loginreturnurl", host + "/");
  form.set("logintoken", token);
  form.set("format", "json");
  form.set("rememberMe", "true")

  resp = await fetch(`${host}/api.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(jar.header() ? { "Cookie": jar.header() } : {}),
    },
    body: form.toString(),
  });
  jar.setFromResponse(resp);
  const data = await expectOk(resp);
  const status = data?.clientlogin?.status;
  if (status !== "PASS") {
    throw new Error(`login failed: ${JSON.stringify(data)}`);
  }
  return jar;
}

export async function mwGet(path: string, jar?: CookieJar): Promise<Response> {
  const base = wikiBase();
  const headers: HeadersInit | undefined = jar?.header()
    ? { "Cookie": jar.header() as string }
    : undefined;
  return fetch(base + path, { headers });
}

export async function mwPost(path: string, body: BodyInit, headers: HeadersInit = {}, jar?: CookieJar): Promise<Response> {
  const base = wikiBase();
  const h: HeadersInit = { ...headers };
  if (jar?.header()) {
    (h as any)["Cookie"] = jar.header()!;
  }
  return fetch(base + path, { method: "POST", headers: h, body });
}
