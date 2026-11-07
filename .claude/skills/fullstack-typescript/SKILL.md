---
name: fullstack-typescript
description: Apply the approved React/Vite and Express/TypeScript architecture when planning or changing frontend, API, or shared contracts.
---

# Full-stack TypeScript

Use this skill for frontend, backend, API, and shared-contract tasks.

- Follow ADR-001 (React + TypeScript + Vite SPA), ADR-002 (Node + Express + TypeScript), and ADR-008 (single Render Node service serving API and built SPA). Confirm current repo conventions before proposing file structure.
- Keep UI, route handlers, domain services, and persistence access separate. Put business rules and authorization checks on the server; never rely on frontend hiding as access control.
- Use typed request/response contracts. Validate all request bodies and query parameters with server-side Zod schemas; return standardized JSON error envelopes with machine-readable error codes, safe human-readable messages, and the HTTP status codes required by the relevant specification.
- Implement discovery query behavior, pagination, bounds, truncation indicators, and URL state as specified; do not invent search/geocoding capabilities.
- Keep secrets and database credentials server-side. Follow the approved Better Auth and cookie/CSRF design rather than creating a parallel authentication system. For cookie-authenticated state-changing POST, PUT, PATCH, and DELETE requests, enforce strict Origin validation with the approved Referer fallback in Express middleware; reject missing or untrusted origin evidence as specified. Use HttpOnly, Secure (in production), and SameSite cookies. Preserve Better Auth endpoint compatibility and verify middleware placement against its supported behavior.
- Enforce sensitive-location redaction centrally in API responses and shared-trip views, not only in map rendering.
- Register Express SPA fallback routes last, after API, auth, static assets, and health routes. Unknown `/api/*` paths must return JSON error envelopes (not SPA HTML), including unsupported methods where applicable.
- Maintain accessible list-based alternatives to map interactions and test loading, empty, and error states.
- Before implementation, identify the feature specification and its acceptance criteria; after implementation, record tests and any deviations.
