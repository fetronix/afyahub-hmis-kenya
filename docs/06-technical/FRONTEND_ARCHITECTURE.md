# Frontend architecture

| Field | Value |
| --- | --- |
| Document | FRONTEND_ARCHITECTURE |
| Version | 1.0 |
| Last reviewed | 2026-11-18 |
| Applies to | JaliCare HMIS 0.1.0, commit `9d7274c` |
| Audience | Frontend engineers |
| Status | Verified against `src/App.tsx`, `src/context/HmisContext.tsx`, `src/components/Sidebar.tsx` and `src/api/clients/http.ts` |

## Shape of the client

A single-page React 19 application built by Vite and styled with Tailwind CSS 4. There is no
client-side router library: the application decides what to render from the browser path (only for a
few entry points) and from the active module held in state.

| Path in the browser | Rendering |
| --- | --- |
| `/portal`, `/portal/activate` | Patient portal (`PatientPortalApp`) |
| `/accept-staff-invitation` | Staff invitation acceptance screen |
| `/accept-facility-admin-invitation` | Facility administrator invitation acceptance |
| Anything else | Staff shell: login screen, or the module selected in `HmisContext` |

Trailing slashes are normalised before this decision, which is why `/portal/activate/` does not fall
through to the staff shell.

## State and context

`HmisContext` holds the authenticated user, the current facility and tenant, the list of enabled and
hidden facility modules, the permission set, the active module, notifications and the patient
selected for the journey modal. It also restores the session at start-up from the stored bearer token
and clears it on `401`.

The context is a UI convenience, not a security boundary: the comment in `HmisContext.tsx` says so
explicitly, and every screen's API calls are authorised again on the server.

## The module switch

`src/App.tsx` renders one of 30-odd module components from `activeModule`:

```tsx
switch (activeModule) {
  case 'registration': return <PatientRegistrationModule key={…} />;
  case 'opd':          return <OutpatientModule key={…} />;
  …
}
```

Before the switch, a guard rejects modules that are not enabled for the facility, are hidden for the
user, or whose anchor permission the user lacks. The rejection message is deliberate:
"This module is not available for the selected facility or account."

The sidebar (`src/components/Sidebar.tsx`) draws the navigation rail in the order of the patient
journey — Clinical Care, Diagnostics, Pharmacy & Supplies, Workforce, Revenue & Payers, Intelligence
& Reporting, Administration — and hides items whose module is disabled or whose permission the user
does not hold. `requires` mappings such as `analytics: ['reports.read']` live in that file.

## API access

`src/api/clients/http.ts` holds the session token under the local-storage key
`jalicare_session_token` (in-memory when storage is unavailable) and attaches it as
`Authorization: Bearer <token>`. Domain clients under `src/api/clients/` wrap `fetch` with typed
request and response shapes.

| Behaviour | Implementation |
| --- | --- |
| Unauthorised response | A registered `onUnauthorizedSession` handler clears the token and returns the user to the login screen |
| Error shape | `ApiError` carries status, error code and message from the server envelope |
| Binary downloads | `httpBytes` for PDFs and documents; `httpJson` would corrupt them |
| Blob handling | Clients revoke object URLs after a timeout to avoid leaking memory |

## Portal

`PatientPortalApp` is a separate component tree with its own token storage
(`jalicare_portal_token`), its own expiry (`jalicare_portal_expiry`) and its own API client
(`src/api/portal-client.ts`). It shares no session state with the staff shell, which mirrors the
server-side separation of `sessions` and `patient_portal_sessions`.

## Styling and layout

- Tailwind utility classes with a small set of design tokens (`ink`, `surface`, `hair`).
- Shared layout primitives in `src/components/ui/layout.tsx`.
- Icons from `lucide-react`.
- No CSS-in-JS runtime and no component library: tables, dialogs and forms are hand-built, which is
  why screens differ in small ways.

## Build

`npm run build` runs `vite build` and writes `dist/`. The server serves `dist/` in production and
falls back to `index.html` for non-API paths so a deep link reaches the SPA. In development,
`npm run dev` runs `tsx server.ts` and Vite middleware compiles on demand.

## Known irregularities

- Editor backup copies of module components are still present in `src/components/modules/`
  (`*.catalogue-fix-*`, `*.fix-backup`); they are not imported, but they clutter the directory.
- Module components are large (Outpatient ~2,000 lines, Inpatient ~2,000 lines, Accounting ~1,400)
  and mix data fetching, calculation and presentation. This is documented rather than fixed in this
  revision.
- Some screens keep their own tab state instead of deriving it from the active module, so a reload
  returns to the module's first tab.

## Limitations

- No component tests or browser automation run in this repository's default suite for screen
  behaviour; frontend coverage is limited to build, type-check and source-level assertions. See
  [TEST_STRATEGY.md](../11-testing-and-acceptance/TEST_STRATEGY.md).
- The interface is English-only and uses KES currency formatting.

## Related documents

- [Application architecture](APPLICATION_ARCHITECTURE.md)
- [Authentication and authorisation](AUTHENTICATION_AND_AUTHORISATION.md)
- [User manual](../02-user-manuals/USER_MANUAL.md)
