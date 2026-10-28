# HWD Main Site

The private HWD Farm family website for Roster-approved sign-in, secure documents, announcements, and links to Farm apps.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- Confirm and state the database host before any reporting query; never write to production.
- Audit before fixing; name verification methods; label inferences; say when unfinished.
- Withhold private data on the server, never merely hide it in the UI.
- Nothing is hard-deleted: retire/end instead (explicit exception: sign-out removes its session).
- Audit log is append-only at the database level. Tests never touch real person records.
- Identity belongs to the HWD Roster; this site keeps no member list and shares no code, cookie, or database with other HWD apps.
- Missing Roster/mail/bootstrap settings disable only their dependent feature, never the build.
- Development emails go to the console, never Resend. Production APP_ORIGIN must be explicit.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
