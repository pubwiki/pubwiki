import { WIKI_HOST } from "./config.ts";
import { CookieJar, expectOk, mwLogin } from "./_util.ts";

function randomSlug(): string {
  return `autotest-${Date.now().toString(36)}`;
}

async function main() {
  const D = (globalThis as any).Deno as any | undefined;
  const slug = D?.env.get("SLUG") ?? randomSlug();
  const name = D?.env.get("NAME") ?? `Auto Test ${slug}`;
  const language = D?.env.get("LANG") ?? "en";
  const visibility = D?.env.get("VISIBILITY") ?? "public";

  const jar: CookieJar = await mwLogin();

  const body = { name, slug, language, visibility };
  console.log("Create wiki at " + slug)
  const resp = await fetch(`${WIKI_HOST.replace(/\/$/, "")}/provisioner/v1/wikis`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(jar.header() ? { "Cookie": jar.header() as string } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await expectOk(resp);
  const sseUrl = `${WIKI_HOST.replace(/\/$/, "")}/provisioner/v1/tasks/${data.task_id}/events`;
  console.log(JSON.stringify({ slug, task_id: data.task_id, sse: sseUrl }, null, 2));
  const ok = await followTaskSSE(sseUrl, jar);
  if (!ok) (globalThis as any).Deno?.exit(1);
}

if ((import.meta as any).main) {
  main().catch((e) => {
    console.error(e);
    (globalThis as any).Deno?.exit(1);
  });
}

async function followTaskSSE(url: string, jar?: CookieJar): Promise<boolean> {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "text/event-stream",
      ...(jar?.header() ? { "Cookie": jar.header() as string } : {}),
      // Avoid proxies or caches buffering
      "Cache-Control": "no-cache",
    },
  });
  if (!resp.ok || !resp.body) {
    console.error(`SSE connect failed: HTTP ${resp.status}`);
    return false;
  }

  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finalOk: boolean | null = null;

  function handleEvent(evt: string, data: string) {
    if (!evt) evt = "message";
    if (evt === "progress") {
      try {
        const j = JSON.parse(data);
        const status = j.status ?? j.type ?? "progress";
        const phase = j.phase ?? null;
        const msg = j.message ?? null;
        console.log(`[progress] status=${status}${phase ? ` phase=${phase}` : ""}${msg ? ` msg=${msg}` : ""}`);
      } catch (_) {
        console.log(`[progress] ${data}`);
      }
    } else if (evt === "status") {
      try {
        const j = JSON.parse(data);
        const status = (j.status || "").toString().toLowerCase();
        const wiki_id = j.wiki_id ?? null;
        const msg = j.message ?? null;
        console.log(JSON.stringify({ event: "status", status, wiki_id, message: msg }, null, 2));
        finalOk = status === "succeeded";
      } catch (_) {
        console.log(`[status] ${data}`);
        // if cannot parse, consider failed
        finalOk = false;
      }
    } else if (evt !== "comment") {
      console.log(`[${evt}] ${data}`);
    }
  }

  // Simple SSE line parser
  let eventName = "";
  let dataLines: string[] = [];
  const flush = () => {
    if (eventName || dataLines.length) {
      handleEvent(eventName, dataLines.join("\n"));
      eventName = "";
      dataLines = [];
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") {
        flush();
        if (finalOk !== null) {
          reader.cancel().catch(() => {});
          return finalOk;
        }
        continue;
      }
      if (line.startsWith(":")) {
        // comment/keepalive
        continue;
      }
      const c = line.indexOf(":");
      const field = c === -1 ? line : line.slice(0, c);
      const value = c === -1 ? "" : line.slice(c + 1).replace(/^\s*/, "");
      if (field === "event") {
        eventName = value;
      } else if (field === "data") {
        dataLines.push(value);
      }
    }
  }
  // Stream ended; flush remaining
  if (buf.length) {
    // treat remaining as a line
    const line = buf.replace(/\r?\n$/, "");
    if (line) dataLines.push(line);
    flush();
  }
  if (finalOk === null) {
    console.error("SSE ended without terminal status");
    return false;
  }
  return finalOk;
}
