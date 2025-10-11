Smoketests (Deno, black-box)

Small TypeScript scripts to call the wiki like a browser/client. No bearer tokens or internal provisioner URLs required.

Requirements
- Deno v1.42+

Setup
1) Edit src/config.ts:
   - WIKI_BASE: full base URL of the target wiki (e.g., https://myslug.example.com)
   - USERNAME / PASSWORD: credentials for a valid wiki user

Run
- Check visibility-ish by fetching the home page and printing status/headers/body snippet:
  deno task check_visibility

- Login and set visibility via manage endpoint (optionally pass visibility):
  deno task auth_and_whoami            # defaults to public
  deno run -A src/set_visibility.ts private

- Check visibility via dedicated API (requires auth, uses cookies):
  deno task check_visibility_api

Notes
- The login flow uses action=clientlogin with tokens; cookies are kept in a simple in-memory jar.
- If you add MediaWiki-side endpoints (e.g., a Special page or custom REST handler), reuse mwLogin/mwGet/mwPost from src/_util.ts.
