# REST API

The REST API lets other systems read and manage one site: charge points and their status, zones, the waitlist, charges, surge pricing and complimentary charging, driver alerts, complaints, and reports.

**Reference:** open `/api/docs` on your server (for example `http://localhost:4000/api/docs`). It is built from [`openapi/openapi.yaml`](../openapi/openapi.yaml), the source of truth for the API, and lists every endpoint, the permission it needs, and the request and response shapes.

## Access

Access belongs to a **service account**, not to a person.

1. Under **Admin > API access**, add a service account and tick the permissions it needs. Read permissions let it look; write and control permissions let it change things. You can only grant permissions you hold yourself.
2. Create an API key for the account. The full key (it starts with `pgk_`) is shown once. Only its hash is stored, so a lost key cannot be recovered; create a new one instead.
3. Send the key with each request:

   ```
   Authorization: Bearer pgk_...
   ```

Disabling an account stops all its keys. Revoking a key stops only that key. Each key works only for the site its account belongs to.

Someone who builds integrations can have the built-in **API Developer** role, which manages service accounts and grants any API permission without the rest of the Admin role.

## Conventions

- Bodies are JSON. Timestamps are ISO 8601 in UTC.
- Lists return a page: `{ "data": [...], "nextCursor": "..." }`. Pass `limit` (1 to 200, default 50) and, for the next page, `cursor` (the `nextCursor` you received). `nextCursor` is `null` on the last page.
- Errors have an `error` message and, where useful, a `code`. A `403` names the missing permissions in `missing`.
- Every change made through the API is recorded in the audit log (see [Audit log](audit.md)).
- The API never returns driver names, contact details, licence plates, or payment links.
- Network-wide pricing rules and alerts can only be created by the installation administrator, so the API refuses them.

## Building the reference

The reference is generated, so it is not committed:

```
npm run docs:api:lint    # check the spec
npm run docs:api:build   # write server/public/api-docs/ (also run by npm start and npm run build)
```

The page is served at `/api/docs`, and the bundled spec at `/api/v1/openapi.json`. Change the API by editing `openapi/openapi.yaml` and the routes in `server/src/routes/api.v1/`. The test suite checks that every documented operation has a route and that each route refuses a key without the permission the spec declares.
