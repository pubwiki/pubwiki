[working-directory: 'apps/studio']
studio:
    pnpm dev

[working-directory: 'apps/hub']
hub:
    pnpm dev --host 0.0.0.0

[working-directory: 'apps/player']
player:
    pnpm dev

[working-directory: 'apps/sandbox']
sandbox:
    pnpm build && pnpm preview --port 4001

[working-directory: 'services/hub']
backend:
    pnpm dev --ip 0.0.0.0

[parallel]
all: studio hub player sandbox backend