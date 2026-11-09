# Driver accounts

Drivers can save their details and vehicles on an account. Driver accounts use the same sign-in and permission checks as admin accounts. An admin account can also manage its own vehicles.

## Sign in

Drivers sign in at `/login` (or `/t/<slug>/login` for a named site).

- **With a password.** Set one on your account page. Admins also enter a two-factor code if it's on.
- **With a one-time code.** Enter your email address and get a six-digit code. The code expires in 10 minutes and works once. Five wrong guesses use up a code, and you can request five codes per address per hour. A new email address gets a driver account on its first correct code. Requires email set up for the site.

Admin accounts always sign in with a password, so they can't skip the two-factor step.

After you sign in, admins go to the admin pages and drivers go to their account page. The old `/sign-in` address redirects to `/login`.

Driver-only accounts can't reach admin routes. The server returns `DRIVER_ACCOUNT`.

## Set site rules

Under **Waitlist settings**:

- **Driver accounts.** Choose *Optional* to let guests join and charge. Signed-in drivers get their details filled in. Choose *Required* to make drivers sign in before they join or charge.
- **Contact details.** Turn this on to require an email address or mobile number to join. Turn it off to let drivers join without one. Drivers who join without contact details don't get notified when a charger frees up.

A signed-in driver's name, email, and first vehicle's plate fill in the join form.

## Add vehicles

Add each vehicle with every plug it can use, including adapters. For example, an IONIQ 5 uses J1772, NACS, and CCS1. On the charger finder, select **Use my vehicles' plugs** to filter for every plug your vehicles accept.

## Routes

| Route | Who | Purpose |
|---|---|---|
| `POST /api/auth/login` | Anyone | Sign in with a password |
| `POST /api/auth/code/request` | Anyone | Email a sign-in code |
| `POST /api/auth/code/verify` | Anyone | Sign in with a code (creates a new driver account) |
| `GET`/`PUT /api/driver/me` | Driver | Read or update name and mobile number |
| `PUT /api/driver/password` | Driver | Set or change password |
| `GET`/`POST /api/driver/vehicles`, `PUT`/`DELETE /api/driver/vehicles/:id` | Driver | Manage vehicles |

For a named site, use `/api/t/<slug>/auth/code` and `/api/t/<slug>/driver`. Each driver account belongs to one site. An email address can have one account across the installation.
