# Driver accounts

A driver can keep their details and vehicles on an account. The account is an ordinary account
in the admin user table, with the driver role, so it uses the same sign-in tokens and permission
checks as admins. An admin can also be a driver: admin accounts hold the driver permission
(`driver.account`) as well, so they can manage their own vehicles.

## Signing in

- **One-time code.** The driver enters their e-mail address and gets a six-digit code, valid for
  10 minutes, which can be used once. Five wrong guesses use up a code. At most five codes can be
  asked for per address per hour. A new e-mail address gets a driver account on the first correct
  code. Codes need e-mail to be set up for the site; otherwise the driver is told to use a password.
- **Password.** A driver can set a password on their account page and sign in with it.
- **Admins** sign in on the admin sign-in page, with their password and two-factor code. Admin-capable
  accounts are refused on the driver sign-in, so the two-factor step cannot be skipped.

A driver-only account cannot use any admin route; the server refuses it with `DRIVER_ACCOUNT`.

## Site settings

- **Driver accounts** (Waitlist settings): *Optional* lets guests join and start charging; a signed-in
  driver has their details filled in. *Required* makes a driver sign in before they join the
  waitlist or start charging.
- **Contact details** (Waitlist settings): when on, a waitlist join needs an e-mail address or mobile
  number. When off, a driver may join without one, and is not told when a charger is free.

A signed-in driver's name and e-mail address fill in the join form. Their first vehicle's licence
plate fills in too, if it has one.

## Vehicles

A driver adds each vehicle with the plugs it can charge with, including with an adapter (for
example an IONIQ 5 with J1772, NACS and CCS1). On the charger finder, "Use my vehicles' plugs" sets
the plug filter to every plug the driver's vehicles can use, so charge points that work with one
of them are shown.

## Routes

| Route | Who | Purpose |
|---|---|---|
| `POST /api/driver/code/request` | anyone | Sends a sign-in code by e-mail |
| `POST /api/driver/code/verify` | anyone | Signs in with the code (creates the account if new) |
| `POST /api/driver/login` | driver accounts | Signs in with a password |
| `GET`/`PUT /api/driver/me` | driver | Name and mobile number |
| `PUT /api/driver/password` | driver | Sets or changes the password |
| `GET`/`POST /api/driver/vehicles`, `PUT`/`DELETE /api/driver/vehicles/:id` | driver | Own vehicles |

Each is also mounted under `/api/t/<slug>/driver` for a named site. Driver accounts belong to one
site. An e-mail address can have one account across the installation, as admin accounts do.
