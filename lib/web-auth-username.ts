/**
 * The Basic Auth username omp-web accepts.
 *
 * This is a fact three surfaces need and none may duplicate: the request
 * authorizer (`lib/web-auth.ts`), the locked-out page rendered by the middleware,
 * and the recovery page. The recovery page is a client component, so the value
 * cannot live in `lib/web-auth.ts` — that module imports the credential store,
 * which pulls `node:crypto` and `node:fs` into whatever bundle imports it.
 *
 * `bin/web-auth-store.js` keeps its own copy because the launcher loads it as
 * plain CommonJS before Bun exists; keep the two in step.
 */
export const WEB_AUTH_USERNAME = "nolan";
