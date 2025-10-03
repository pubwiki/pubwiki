# Portal Monorepo

- extension/: MediaWiki extension (UI + REST proxy + schema)
- service/: Rust microservice (API + tasks + SSE)

## Provisioning Roadmap (Wiki Creation)

This documents the end-to-end flow for creating a child wiki in the farm. The microservice performs these steps asynchronously and reports progress via SSE.

### Required environment

- WIKIFARM_DIR: base directory where per-wiki directories live
- WIKIFARM_OAUTH_DIR: base directory for OAuth2 keypairs per wiki
- WIKIFARM_TEMPLATE: path to template directory to clone when creating a wiki
- WIKIFARM_INSTANCE: identifier of the wikifarm container instance
- PORTAINER_ENDPOINT: Portainer API endpoint used to exec into the instance
- WIKI_DB_ADMIN_USER / WIKI_DB_ADMIN_PASSWORD: DB admin to create db/user/grants
- Also used in ini rendering:
  - WIKI_ROOT_HOST
  - WIKI_DB_HOST, WIKI_DB_NAME, WIKI_DB_USER, WIKI_DB_PASSWORD, WIKI_SHARED_DB_NAME
  - OPENSEARCH_USER, OPENSEARCH_PASSWORD, OPENSEARCH_ENDPOINT
  - REDIS_PASSWORD, REDIS_SERVER (also used by this microservice)

### Phases (with rollback hints)

1) Directory CoW copy
- Copy WIKIFARM_TEMPLATE -> WIKIFARM_DIR/<slug>
- Prefer reflink (cp --reflink=auto -a), fallback to rsync/cp -a
- Rollback: delete created directory if later steps fail

2) Render pubwiki.ini
- Compute values:
  - WIKI_SITE_NAME = name
  - WIKI_ROOT_HOST from env
  - WIKI_HOST_URL = slug + "." + WIKI_ROOT_HOST
  - WIKI_META_NAMESPACE = name with spaces replaced by underscores
  - DB/Shared DB/OpenSearch/Redis values from env
  - WIKI_LANG = language
  - WIKI_BOOTSTRAPING = true (initial)
- Rollback: delete file or the directory

3) Database provision (admin)
- SQL (idempotent): CREATE DATABASE, CREATE USER, GRANT, FLUSH PRIVILEGES
- Grants include read/write to the wiki db and selected tables in shared db
- Rollback best-effort: revoke, drop user, possibly drop db if created in this run

4) OAuth keypair
- Generate oauth.key (private) and oauth.cert (public) in WIKIFARM_OAUTH_DIR/<slug>/
- Use pure Rust (rcgen + pem) to generate key/cert; avoid shelling out
- Rollback: delete generated files/dir

5) Initialize in container (Docker)
- Exec inside WIKIFARM_INSTANCE:
  - php maintenance/run installPreConfigured
  - php extensions/CirrusSearch/maintenance/UpdateSearchIndexConfig.php
- Prefer talking to local Docker daemon over Unix socket (e.g., with bollard)
- Rollback: none (scripts should be idempotent)

6) Flip bootstrap off
- Set WIKI_BOOTSTRAPING=false in pubwiki.ini
- Rollback: set true on failure in later steps

7) Initial indexing
- Exec in container:
  - php extensions/CirrusSearch/maintenance/ForceSearchIndex.php --skipLinks --indexOnSkip
  - php extensions/CirrusSearch/maintenance/ForceSearchIndex.php --skipParse

### Events and task status
- progress: { status: "running", progress: <int>, message, phase }
- status: { status: "succeeded"|"failed", wiki_id?, message? }
- Updates also persisted into wikifarm_tasks

### Modules (service/src/provision)
- orchestrator.rs: run phases, publish events, persist task status, orchestrate rollback
- fs.rs: CoW copy, mkdir, chmod
- ini.rs: read/write INI (template -> filled pubwiki.ini)
- db.rs: admin SQL, idempotent ops, rollback helpers
- oauth.rs: keypair creation (rcgen)
- docker.rs: exec commands in container (bollard)
- env.rs: typed env gathering/validation

### Safety & recovery notes
- Prefer idempotent operations per phase; keep a rollback ledger per task
- Publish errors immediately with actionable messages
- Add metrics (durations, success/failure counters) later

---

For extension UI details and DB schema, see extension/README.md and extension/sql/tables.sql.