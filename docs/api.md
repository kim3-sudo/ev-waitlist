# REST API

Use the REST API to read and manage one site: charge points, zones, the waitlist, charges, pricing, alerts, complaints, and reports.

Open `/api/docs` on your server for the full reference, which lists every endpoint, permission, and request shape. The source is [`openapi/openapi.yaml`](../openapi/openapi.yaml).

## Get an API key

1. Go to **Admin > API access** and add a service account. Tick the permissions it needs. You can grant only permissions you hold.
2. Create an API key for the account. Copy it right away, because it appears only once and starts with `pgk_`. If you lose it, create a new key.
3. Send the key with each request:

   ```
   Authorization: Bearer pgk_...
   ```

Disable an account to stop all its keys. Revoke a key to stop only that key.

To let someone else build integrations, give them the **API Developer** role. It manages service accounts without the rest of the Admin role.

## Use the API

- Send and receive JSON. Timestamps use ISO 8601 in UTC.
- Page through lists with `limit` (1 to 200, default 50) and `cursor`. Pass the `nextCursor` from each response to get the next page. The last page returns `null`.
- Read the `missing` field on a `403` to see which permissions to add.
- Expect every change to appear in the [audit log](audit.md).
- Expect the API to omit driver names, contact details, licence plates, and payment links.
- Create network-wide pricing rules and alerts in the admin pages. The API refuses them.

## Build the reference

```
npm run docs:api:lint    # check the spec
npm run docs:api:build   # write the reference (npm start and npm run build also run this)
```

The reference appears at `/api/docs`, and the spec at `/api/v1/openapi.json`. To change the API, edit `openapi/openapi.yaml` and the routes in `server/src/routes/api.v1/`. Run the tests after each change.
