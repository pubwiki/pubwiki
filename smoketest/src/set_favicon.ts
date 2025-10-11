import { expectOk, mwLogin, mwPost } from "./_util.ts";

function usage(): never { throw new Error("Usage: deno run -A src/set_favicon.ts <path-to-image>"); }

const path = (globalThis as any).Deno?.args?.[0] ?? usage();

function detectMime(bytes: Uint8Array, fallback = "application/octet-stream"): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon";
  return fallback;
}

const bytes = await (globalThis as any).Deno.readFile(path);
const filename = path.split("/").pop() || "favicon.ico";
const mime = detectMime(bytes);

const jar = await mwLogin();

const form = new FormData();
const file = new File([bytes], filename, { type: mime });
form.append("file", file);

const resp = await mwPost("/manage/v1/wikis/favicon", form, {}, jar);
const data = await expectOk(resp);
console.log("upload result:", data);
