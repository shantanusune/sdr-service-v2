# Copilot / AI Agent Instructions

Purpose: concise, actionable guidance for AI coding agents to be productive in this repo.

1) Big picture
- Frontend SPA: React + TypeScript + Vite (see [package.json](package.json)).
- Auth boundary: Keycloak OIDC live or a mock mode. Core auth code: [src/auth/keycloak.ts](src/auth/keycloak.ts) and [src/auth/AuthProvider.tsx](src/auth/AuthProvider.tsx).
- API boundary: REST through `src/api/http.ts` and `src/api/client.ts`. Environment-controlled base URL: `VITE_API_BASE_URL`.
- Real-time: WebSockets for spectrum and telemetry. See [src/realtime/useSpectrumWS.ts](src/realtime/useSpectrumWS.ts) and env `VITE_WS_BASE_URL`.
- Workers: CPU-heavy filtering runs in `src/workers/filterWorker.ts` and is orchestrated by `engine/filterEngine.ts` and `services/filterStore.ts`.

2) Common developer workflows (what to run)
- Install: `npm install` (project uses Node 18+). See README for Keycloak steps.
- Dev server: `npm run dev` (Vite). Build: `npm run build`. Preview: `npm run preview`.
- Lint: `npm run lint` (ESLint). No test runner configured in repository.

3) Key conventions & patterns (project-specific)
- UI: uses shadcn-style components under `src/components/ui/*`. Follow component props and CSS utility patterns already present.
- Pages live in `src/pages/*`; routing is React Router v6 (check `main.tsx` / `App.tsx`).
- Auth checks: use `RequireAuth.tsx` and `RequireRole.tsx` for route protection. To add an auth-guarded page mirror the pattern used in `src/pages/SpectrumLab.tsx`.
- API helpers: use `http.get/post/put/delete` from `src/api/http.ts` which attach auth tokens. For new endpoints, update `src/api/client.ts` only when you want a typed wrapper.
- WebSocket lifecycle: keep socket logic in `src/realtime/*`. Spectrum overlays are processed by `src/services/spectrumAdapter.ts` (look there for message shapes).
- Worker messages: follow the existing message DTOs in `src/workers/filterWorker.ts` and `engine/filterEngine.ts`—they pass arrays of spectral data and config objects.

4) Integration & external dependencies to be aware of
- Keycloak: README provides Docker run and realm/client setup. Use `VITE_MOCK_AUTH=true` to bypass Keycloak in dev.
- Map: MapLibre GL used in map views (see `src/pages/MapPage.tsx` and `components` mapping code).
- Charts: spectrum rendering is custom/canvas-based; adding features usually requires touching `components/charts/SpectrumChart.tsx` and `services/spectrumAdapter.ts`.

5) Safe editing guidance
- Small UI changes: prefer adding components under `src/components/ui` and reuse existing `button.tsx`, `input.tsx`, `card.tsx` patterns.
- Auth/API changes: update `src/auth/*` and `src/api/*` together. If adding new envs, also update README and `.env.example`.
- WebSocket / Worker changes: add tests manually (no framework here). Validate message shapes by running the dev server with `VITE_MOCK_API=true` / `VITE_MOCK_AUTH=true`.

6) Useful examples
- Auth-protected fetch:
```ts
import { http } from '@/api/http'
const devices = await http.get('/api/devices')
```
- Start dev server (Keycloak mock):
```bash
VITE_MOCK_AUTH=true VITE_MOCK_API=true npm run dev
```

7) Files to inspect for deeper context
- `package.json` (scripts & deps)
- `README.md` (Keycloak and envs)
- `src/auth/*` (Keycloak + guards)
- `src/api/http.ts`, `src/api/client.ts` (HTTP + typed clients)
- `src/realtime/useSpectrumWS.ts` and `src/services/spectrumAdapter.ts` (WS protocol)
- `src/workers/filterWorker.ts` and `engine/filterEngine.ts` (worker protocol)

If any section is unclear or you'd like more examples (e.g., message DTOs, sample WebSocket payloads, or a `CHANGELOG`-style note for planned refactors), tell me which area and I'll extend this file.
