import { expectOk, mwGet, mwLogin, mwPost, wikiBase } from "./_util.ts";

// This script demonstrates authenticated session (login) against MediaWiki.
// After logging in, you can call your exposed manage UI/API endpoints if they are
// proxied under the same domain (e.g., a Special page or custom REST endpoint).

// Read desired visibility from CLI if available (public|unlisted|private)
const getArg = (i: number) => (globalThis as any)?.Deno?.args?.[i];
const visibility = (getArg(0) ?? "public").toLowerCase();
if (!["public", "unlisted", "private"].includes(visibility)) {
	throw new Error("visibility must be one of: public|unlisted|private");
}

const jar = await mwLogin();

// Example: whoami (via MW page hit, cookies carried)
const resp = await mwGet("/api.php?action=query&meta=userinfo&format=json", jar);
console.log("whoami status:", resp.status);
const who = await expectOk(resp);
console.log("userinfo:", who?.query?.userinfo ?? who);

// Call provisioner manage endpoint through the wiki domain (Traefik routes it),
// carrying logged-in cookies so ForwardAuth can authorize.
const resp2 = await mwPost(
	"/manage/v1/wikis/visibility",
	JSON.stringify({ visibility }),
	{ "Content-Type": "application/json" },
	jar,
);
const body2 = await expectOk(resp2);
console.log("set_visibility:", body2);
