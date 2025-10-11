import { mwGet, mwLogin, wikiBase } from "./_util.ts";

const jar = await mwLogin();
const resp = await mwGet("/wiki/Main_Page", jar)
console.log("status:", resp.status);
console.log("x-wiki-visibility:", resp.headers.get("x-wiki-visibility"));
console.log("x-robots-tag:", resp.headers.get("x-robots-tag"));
