import { wikiBase, expectOk } from "./_util.ts";

// Black-box: hit the wiki root and check robots header to infer unlisted
const resp = await fetch(wikiBase() + "/wiki/Main_Page");
console.log("status:", resp.status);
console.log("x-robots-tag:", resp.headers.get("x-robots-tag"));
const text = await resp.text();
console.log("body-snippet:", text.slice(0, 200));
