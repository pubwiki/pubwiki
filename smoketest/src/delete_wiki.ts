import { CookieJar, expectOk, mwLogin } from "./_util.ts";
import { WIKI_HOST } from "./config.ts";

function requireSlug(): string {
  const D = (globalThis as any).Deno as any | undefined;
  const args: string[] = D?.args ?? [];
  if (args.length > 0 && args[0]) return args[0];
  const envSlug = D?.env.get("SLUG");
  if (envSlug) return envSlug;
  throw new Error("Usage: deno task delete_wiki <slug>  (or set SLUG env)");
}

async function main() {
  const slug = requireSlug();
  const jar: CookieJar = await mwLogin();
  const url = `${WIKI_HOST.replace(/\/$/, "")}/provisioner/v1/wikis/${encodeURIComponent(slug)}`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      ...(jar.header() ? { "Cookie": jar.header() as string } : {}),
    },
  });
  const data = await expectOk(resp);
  console.log(JSON.stringify({ msg: data.msg, slug }, null, 2));
}

if ((import.meta as any).main) {
  main().catch((e) => {
    console.error(e);
    (globalThis as any).Deno?.exit(1);
  });
}
