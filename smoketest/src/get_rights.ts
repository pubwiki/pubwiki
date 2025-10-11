import { expectOk, mwGet, mwLogin } from "./_util.ts";

// Log in to MediaWiki and fetch current user's groups/rights
const jar = await mwLogin();

const resp = await mwGet(
  "/api.php?action=query&meta=userinfo&uiprop=groups|implicitgroups|rights&format=json",
  jar,
);

const data = await expectOk(resp);
const ui = data?.query?.userinfo ?? {};

console.log("username:", ui.name ?? "<unknown>");
console.log("id:", ui.id);
console.log("groups:", ui.groups ?? []);
console.log("implicitgroups:", ui.implicitgroups ?? []);
console.log("rights_count:", Array.isArray(ui.rights) ? ui.rights.length : 0);
