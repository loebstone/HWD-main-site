# HWD Main Site

The private HWD Farm family website for Roster-approved sign-in, secure documents, announcements, and links to Farm apps.

## Run & operate

- Start API: `pnpm --filter @workspace/api-server run dev` (workflow: **API Server**).
- Start site: `pnpm --filter @workspace/hwd-main-site run dev` (workflow: **web**).
- Typecheck: `pnpm run typecheck`; build: `pnpm run build`.
- Regenerate API hooks and Zod schemas: `pnpm --filter @workspace/api-spec run codegen`.
- Apply Drizzle schema in development only: `pnpm --filter @workspace/db run push`.
- Append-only audit and no-hard-delete protections install idempotently when the API starts. The manual `security:dev` command is for development only.
- Automated security and browser suite: `pnpm --filter @workspace/api-server test`. Browser walk-through also needs Playwright Chromium.
- Tests use an isolated, randomly named schema in the development database and synthetic identities only.
- Before any reporting query, state the environment and confirm the database host. Never write to production.

## Required secrets and settings

- `DATABASE_URL` — Replit PostgreSQL connection.
- `SESSION_SECRET` — session, token, and rate-limit hashing.
- `SITE_SERVICE_KEY` — bearer credential for the HWD Roster service check.
- `ROSTER_BASE_URL` — HWD Roster origin.
- `MAIL_FROM` — sender address.
- `BOOTSTRAP_PERSON_ID` — Roster person id eligible for the one-time first-admin grant.
- `APP_ORIGIN` — explicit public origin in production; development may derive `https://$REPLIT_DEV_DOMAIN`.
- Resend is called through the connected Replit integration using `@replit/connectors-sdk`; there is no separate `RESEND_API_KEY` app variable.
- Private App Storage uses the Replit-provided bucket configuration (`DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, and `PUBLIC_OBJECT_SEARCH_PATHS` as applicable); do not make document objects public.
- Missing optional Roster, mail, bootstrap, or origin configuration disables only the feature that needs it, with a clear server log. It does not block build/startup. Never invent a fallback identity, send development mail, or derive a production origin.

## Stack

- pnpm workspace, Node.js 24, TypeScript; Express 5 API.
- React, Vite, Tailwind, shadcn/ui.
- PostgreSQL and Drizzle ORM; Zod validation; OpenAPI contract and generated Orval hooks.
- Private file objects in Replit App Storage; never expose bucket URLs or signed public links.

## Where things live

- `artifacts/hwd-main-site/` — HWD Farm website, pages, components, visual assets, and Vite configuration.
- `artifacts/hwd-main-site/src/pages/admin/admin-features.tsx` — admin announcements, home notice, apps, people/grants, and audit screens.
- `artifacts/api-server/src/routes/auth.ts` and `src/lib/auth.ts` — sign-in, one-time tokens, sessions, and sign-out.
- `artifacts/api-server/src/routes/documents.ts` and `src/lib/documents.ts` — document metadata, upload, replace, retire, and protected open.
- `artifacts/api-server/src/routes/announcements.ts`, `routes/settings.ts`, and `routes/audit.ts` — announcements, home notice, app links, and filtered audit history.
- `artifacts/api-server/src/lib/site-content.ts` — announcement and settings validation, defaults, and live/past selection.
- `artifacts/api-server/src/lib/roster.ts` — server-to-server identity check against HWD Roster.
- `artifacts/api-server/src/lib/private-storage.ts` — private object storage adapter.
- `artifacts/api-server/src/lib/audit.ts` — audit append operation.
- `artifacts/api-server/src/middlewares/security.ts` and `src/app.ts` — session/role checks, visitor rate limits, CSRF, security headers, and error handling.
- `artifacts/api-server/tests/foundation.test.ts` — isolated tests with stubbed Roster, test email transport, and optional Chromium walk-through.
- `lib/db/src/schema/` — Drizzle tables; `lib/db/security.sql` — database-enforced append-only and hard-delete protections.
- `lib/api-spec/` — source OpenAPI contract and code generation configuration.
- `generated-artifacts/` — local test screenshots; ignored by Git/deployment.
- `artifacts/hwd-main-site/public/images/hwd-farm-illustration.jpg` — downloaded public home illustration.

## Architecture and security decisions

- Roster is authoritative; the site stores no independent member directory. Sign-in tokens and session cookies are random bearer secrets whose database representation is SHA-256 hashed.
- Email is neutral for allowed and refused addresses. Development sign-in links go only to server logs; production delivery uses the connected Resend integration. The continue page checks the token without consuming it; only the Continue action attempts the atomic single-use consume.
- All API routes require a valid session except the explicit anonymous list below. Roles are checked on the server for every protected operation.
- Document downloads are authenticated streams with `Cache-Control: no-store`; private object keys never reach the client. PDF uploads are signature-checked and capped at 50 MB.
- Documents, grants, and announcements are retired/ended, not deleted. Sign-out is the requested exception and removes that session row.
- Audit rows are protected by database triggers against UPDATE, DELETE, and TRUNCATE, and public mutation grants are revoked. On API startup, the application idempotently creates missing functions/triggers in every environment; it never drops/recreates them or changes existing rows. `lib/db/security.sql` is the readable source at the repository root. The API build copies that source to `artifacts/api-server/dist/security.sql`; the bundled startup installer reads the adjacent copy, so deployment does not depend on retaining the source tree. Source-mode tests fall back to the readable source. `security:dev` is a local development-only installer.
- `site_session` is the only site cookie; its 30-day sliding expiry has a 12-month absolute limit. Daily Roster checks retry one time only on network/timeout/server unavailability (5 seconds, then 8 seconds); a continued outage is throttled for an hour and tolerated for up to three days since the last successful check. A real not-allowed answer ends the session immediately.
- **Database separation:** each Replit app has its own PostgreSQL instance, even though the default database name is `heliumdb`. This site's `heliumdb` is a separate instance from the Roster's database. The development query returned `current_database() = heliumdb`; `inet_server_addr()` returned `NULL` because this connection uses a local socket. The configured instance host is `helium`.

## Old-site content import

- Admin > Documents has an admin-only **Import from old site** panel. Server routes are `GET/POST /api/admin/old-site-import`; neither is anonymous or editor-accessible.
- `artifacts/api-server/src/lib/old-site-fetch.ts` reads the published CSV fresh on every run, parses quoted CSV, restricts all fetches/redirects to HTTPS Google hosts, limits fetches to 20 seconds and PDFs to 50 MB, and follows at most one Drive confirmation link/form.
- `artifacts/api-server/src/lib/old-site-import.ts` validates/maps each row, continues after individual failures, and uses the same private-storage/document-creation function as manual uploads. No signed/public file URLs are generated. The current published sheet's blank twelfth header is the supporting-text column.
- Importing is idempotent by the original sheet `id`, stored as `legacy_sheet_id` on documents/announcements, including retired records. Per-row database advisory locks and unique indexes prevent concurrent duplicates. Every created row also has an `import` audit entry attributed to the authenticated admin with description `Import from old site: <sheet id>`.
- Runs execute in the background so the HTTP request does not time out. The last run table, time, actor, source hash and progress are persisted as `old-site-import-last-run` in site settings; the UI polls while running. A stale two-minute progress lease reports an interrupted run and permits a safe rerun. Dry runs write the report only, fetch no source files, and label planned rows **would import**.
- The browser panel lives in `artifacts/hwd-main-site/src/components/admin/old-site-import.tsx`; contracts and hooks are generated from the OpenAPI spec.

## Anonymous routes (closed list)

- `GET /api/healthz` — liveness only; exposes no identity or document data.
- `GET /api/public/home-notice` — returns only the notice text when its visibility is public; returns no content when the notice is signed-in only.
- `GET /api/auth/verify` — non-consuming continue-page preflight; token consumption is only by POST.
- `POST /api/auth/link` — generic magic-link request; same visible response for allowed, denied, and unavailable Roster.
- `POST /api/auth/verify` — single-use token verification and session creation.
- Public pages: `/sign-in` and `/auth/continue` only. All other API requests require a session; signed-in pages redirect to sign-in when anonymous.

## Product scope in this foundation

- Family sign-in, member home, Meetings (Shareholders and Directors), Calendar, Logging, Governing Docs & Policies, Photo Archive, and Announcements.
- Admin > Documents, Announcements, and Home notice are editor/admin accessible; Apps, People/Access, and Audit are admin-only. App-link filtering and all write authorization are enforced by the server.
- Home supports five live reminders, the role-filtered Farm apps strip, and an admin-editable notice that can optionally appear on the sign-in page.
- No Google embeds or direct public-document links.

## Working rules

- Confirm and state the database host before any reporting query; never write to production.
- Audit before fixing; verification names its method; label inferences; say when unfinished.
- Private data is withheld on the server, never merely hidden in the UI.
- Nothing is hard-deleted: retire/end instead (sign-out may remove its session).
- Audit log is append-only at the database level. Tests never touch real person records.
- Identity comes from the HWD Roster. Do not share the member list, cookie, or application database with the other HWD apps.
- Keep missing settings feature-local; development mail is console-only; production `APP_ORIGIN` must be explicit.
