# Tennessee Natural Landmarks Explorer

See `docs/PROJECT_PLAN.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/DECISIONS.md` for the
project's scope, roadmap, and architectural decisions. `specs/README.md` indexes the approved
feature specifications. This README's full project overview, architecture summary, and
deployment documentation will be completed in Milestone 07 (M07-T06); this section only covers
local development setup for the foundation established in M00-T04.

## Development Setup

Requires Node.js >= 22 and Docker (for the local PostgreSQL/PostGIS database).

```bash
npm install
cp backend/.env.example backend/.env
docker compose up -d
npm run dev
```

This starts the Express backend on port 3000 and the Vite dev server (with hot reload) on its
default port, proxying `/api/*` and `/health` to the backend. Visit the URL Vite prints.

Other root-level commands:

```bash
npm run build       # builds backend then frontend
npm run typecheck   # type-checks both workspaces
npm run lint        # lints both workspaces
npm run format      # formats the repository with Prettier
```

`docker compose up -d` creates two local databases on the same Postgres/PostGIS instance:
`landmarks_dev` for development and `landmarks_test` for future automated integration tests
(the test framework itself is configured in M00-T05).
