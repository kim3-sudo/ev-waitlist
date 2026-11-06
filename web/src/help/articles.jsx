import { Alert, Box, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

// Help articles. `permission` (optional) is the permission key a role needs to see
// the article. Articles without one are visible to everyone who can sign in.
// Write new articles in the second person, with a friendly tone and the active voice.

const Steps = ({ children }) => (
  <Box component="ol" sx={{ pl: 3, '& > li': { mb: 1 } }}>
    {children}
  </Box>
);

const Para = ({ children }) => (
  <Typography variant="body1" sx={{ mb: 2 }}>
    {children}
  </Typography>
);

export const HELP_ARTICLES = [
  {
    id: 'your-role',
    title: 'Understanding your role',
    body: (
      <>
        <Para>
          Every account has a role, and your role decides what you can change. You only see the parts of the app that
          your role allows.
        </Para>
        <Para>
          <strong>Admin</strong> is built in and can do everything. <strong>Viewer</strong> is built in and is read-only
          for charge points, zones, complaints, and reports. Your administrator can also create custom roles, such as
          Electrician, with exactly the permissions they need. See <em>Creating custom roles</em> for details.
        </Para>
        <Alert severity="info">
          Need a different role? Ask an admin to change it under Admin, then Users.
        </Alert>
      </>
    ),
  },
  {
    id: 'your-profile',
    title: 'Managing your profile',
    body: (
      <>
        <Para>
          Select <strong>Profile</strong> in the top bar to open the menu. From there, you can open{' '}
          <strong>My profile</strong> or <strong>Log out</strong>.
        </Para>
        <Typography variant="h6" gutterBottom>
          Add a second check to your sign-in
        </Typography>
        <Steps>
          <li>Open My profile and find the Two-factor authentication section.</li>
          <li>Select <strong>Enable two-factor authentication</strong>.</li>
          <li>Scan the QR code with your authenticator app.</li>
          <li>Enter the six-digit code from the app to confirm.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          Change your password
        </Typography>
        <Para>
          If you sign in with a password, open My profile and find the Change password section. Enter your current
          password, then your new one. Accounts that sign in through single sign-on don't have a password to change.
        </Para>
        <Typography variant="h6" gutterBottom>
          Log out
        </Typography>
        <Para>
          Select <strong>Profile</strong>, then <strong>Log out</strong>. You can sign in again at any time.
        </Para>
      </>
    ),
  },
  {
    id: 'view-charge-points',
    title: 'Viewing charge points',
    body: (
      <>
        <Para>
          Open <strong>Admin</strong> to see every charge point. Each row shows the station name, its identity, location,
          zone, and whether it's online.
        </Para>
        <Steps>
          <li>Type in the search box to filter by name, identity, or location.</li>
          <li>Look at the connector chips to see each connector's current status.</li>
          <li>Hover over a status chip to read what that status means.</li>
        </Steps>
        <Para>
          The list refreshes on its own every few seconds, so you always see the latest status without reloading the page.
        </Para>
      </>
    ),
  },
  {
    id: 'add-charge-point',
    title: 'Adding a charge point',
    permission: 'stations.manage',
    body: (
      <>
        <Para>
          Add a charge point when you install a new charger. The charger connects to the app using its identity, so set
          that up first.
        </Para>
        <Steps>
          <li>Open <strong>Admin</strong> and select <strong>Add charge point</strong>. The guided setup opens.</li>
          <li>
            On <strong>Identity</strong>, enter the <strong>OCPP identity</strong>. It must match the ID your charger uses
            when it connects, and it must be unique.
          </li>
          <li>Enter a <strong>Display name</strong>. This is the name you'll see throughout the app.</li>
          <li>On <strong>Location</strong>, add the location, vendor, and model if you know them, and choose a zone if needed.</li>
          <li>
            On <strong>Connectors</strong>, set the number of plugs on the charger.
          </li>
          <li>On <strong>Review</strong>, check the details and select <strong>Save charge point</strong>.</li>
          <li>
            On <strong>Connect</strong>, point the charger at the address shown. The status changes to{' '}
            <strong>Connected</strong> once the charger reaches the app.
          </li>
        </Steps>
        <Para>
          Prefer a single form? Select <strong>Use the full form</strong> on the first step.
        </Para>
        <Alert severity="success">
          Once the charger connects, its row shows <strong>Online</strong>. If it stays offline, check that the identity
          matches exactly.
        </Alert>
      </>
    ),
  },
  {
    id: 'update-charge-point',
    title: 'Updating a charge point',
    permission: 'stations.manage',
    body: (
      <>
        <Para>
          Change a charge point's details when something about it changes, such as its name, location, or zone.
        </Para>
        <Steps>
          <li>Open <strong>Admin</strong> and find the charge point in the list.</li>
          <li>Select the edit icon in that row.</li>
          <li>Change the details you need, then select <strong>Save</strong>.</li>
        </Steps>
        <Alert severity="warning" sx={{ mb: 2 }}>
          If you change the identity, update the charger's settings to match. Otherwise, the charger can't connect.
        </Alert>
        <Para>
          A charge point in a zone shares one waitlist with the rest of that zone. Moving it to another zone changes
          which waitlist it shares.
        </Para>
      </>
    ),
  },
  {
    id: 'remove-charge-point',
    title: 'Removing a charge point',
    permission: 'stations.manage',
    body: (
      <>
        <Para>
          Remove a charge point when you take it out of service for good. Removing it deletes its waitlist entries,
          reservations, and charging history, so think twice before you continue.
        </Para>
        <Steps>
          <li>Open <strong>Admin</strong> and find the charge point in the list.</li>
          <li>Select the delete icon in that row.</li>
          <li>Read the message, then select <strong>Delete</strong> to confirm.</li>
        </Steps>
        <Alert severity="warning">You can't undo a removal, so you'll need to add the charge point again.</Alert>
      </>
    ),
  },
  {
    id: 'generate-reports',
    title: 'Generating reports',
    body: (
      <>
        <Para>
          Open <strong>Reports</strong> in the top bar. The app builds each report from live data, so you don't need to
          generate anything yourself. Choose a tab to see the report you need.
        </Para>
        <Typography variant="h6" gutterBottom>
          Idle after charging
        </Typography>
        <Para>
          This report lists connectors where a car stayed plugged in after charging finished, over the last seven days.
          Set <strong>Flag after (minutes)</strong> to the wait you consider too long. You'll see the rows that reach
          that limit stand out. A row labeled <strong>Still idle</strong> means the car is still plugged in right now.
        </Para>
        <Typography variant="h6" gutterBottom>
          Complaints summary
        </Typography>
        <Para>
          This report shows line-cutting complaints for each station. Choose a window of seven, thirty, or ninety days.
          You'll see how many complaints each station received, how many are still open, and how long the oldest open
          one has waited. You'll also see how long a typical complaint takes to close.
        </Para>
        <Alert severity="info">Use the summary to spot stations that need attention before the problem grows.</Alert>
      </>
    ),
  },
  {
    id: 'line-cutting-complaints',
    title: 'Handling line-cutting complaints',
    body: (
      <>
        <Para>
          Drivers file a line-cutting complaint when someone else plugs in to the charger they were waiting for. Each
          complaint shows when it was filed, the station, who filed it, and any note they left.
        </Para>
        <Steps>
          <li>Open <strong>Admin</strong>, then select <strong>Complaints</strong>.</li>
          <li>Read the note and check the station and time.</li>
          <li>
            Select <strong>Mark resolved</strong> once you've dealt with the problem, or <strong>Dismiss</strong> if the
            complaint doesn't hold up.
          </li>
        </Steps>
        <Para>
          Viewers can read complaints but can't resolve or dismiss them. Ask an admin to act on a complaint for you.
        </Para>
      </>
    ),
  },
  {
    id: 'manage-users',
    title: 'Managing users',
    permission: 'users.manage',
    body: (
      <>
        <Para>
          Add people who need to use the app, and choose the role each one needs. Open <strong>Admin</strong> and select{' '}
          <strong>Users</strong>.
        </Para>
        <Typography variant="h6" gutterBottom>
          Add a user
        </Typography>
        <Steps>
          <li>Select <strong>Add user</strong>.</li>
          <li>Enter their email address.</li>
          <li>Enter a password, or leave it blank if they'll sign in through single sign-on.</li>
          <li>Choose a role. New users start as viewers, so choose Admin only when they need full access.</li>
          <li>Select <strong>Create</strong>.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          Change a role
        </Typography>
        <Para>
          Use the Role dropdown in the user's row. You can't change your own role, so ask another admin to do it for you.
          The app also keeps at least one admin in place.
        </Para>
        <Typography variant="h6" gutterBottom>
          Reset two-factor authentication or remove a user
        </Typography>
        <Para>
          If someone loses their authenticator, select the lock icon to reset their two-factor authentication. To remove
          someone, select the delete icon and confirm. They lose access straight away.
        </Para>
        <Typography variant="h6" gutterBottom>
          Require two-factor authentication
        </Typography>
        <Para>
          Turn on <strong>Require two-factor authentication for all users</strong> at the top of the page. Everyone without
          two-factor authentication will set it up the next time they sign in.
        </Para>
      </>
    ),
  },
  {
    id: 'custom-roles',
    title: 'Creating custom roles',
    permission: 'users.manage',
    body: (
      <>
        <Para>
          A role is a named set of permissions. Create one when the built-in Admin or Viewer roles are too broad or too
          narrow, such as an <strong>Electrician</strong> who can add charge points but can't change payments, or a
          read-only role for auditors.
        </Para>
        <Typography variant="h6" gutterBottom>
          Create a role
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, select <strong>Users</strong>, and find the <strong>Roles</strong> section.</li>
          <li>Select <strong>Create role</strong>.</li>
          <li>Enter a name, such as <em>Electrician</em>, and an optional description.</li>
          <li>
            Tick each permission the role should have. Permissions are grouped by area, such as Charge points or
            Payments.
          </li>
          <li>Select <strong>Save role</strong>.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          Give a role to a user
        </Typography>
        <Para>
          Create a user under <strong>Add user</strong> and choose the role, or change the Role dropdown in the user's row.
          The change applies the next time that user loads a page.
        </Para>
        <Typography variant="h6" gutterBottom>
          What you can and can't do
        </Typography>
        <Para>
          You can only grant permissions you hold yourself. If a permission is greyed out in the role editor, you don't
          have it, so ask an admin who does. The same rule applies to editing or deleting a role, and to changing or
          removing a user whose role has permissions you don't hold.
        </Para>
        <Para>
          The app always keeps at least one user who can manage users and roles, so you can't lock everyone out.
        </Para>
        <Alert severity="info">
          Built-in roles can't be edited. To delete a custom role, first move every user with that role to another role.
        </Alert>
      </>
    ),
  },
  {
    id: 'system-settings',
    title: 'Changing system settings',
    permission: 'system.manage',
    body: (
      <>
        <Para>
          Open <strong>Admin</strong>, then <strong>System</strong>, to change the web addresses and general behavior of
          the app. Changes take effect straight away, with no server restart.
        </Para>
        <Steps>
          <li>
            <strong>Public address of this server</strong>: the address other systems use to reach this server, such as
            single sign-on and Square webhooks.
          </li>
          <li>
            <strong>Web app address</strong>: where drivers are sent to pay, and where Stripe and Square send them back after
            checkout.
          </li>
          <li>
            <strong>Allowed web origin</strong>: the address the admin web app is served from. Browsers from any other
            address can't call the API.
          </li>
          <li>
            <strong>Reservation window</strong>: how many minutes the next driver has to plug in once a spot opens.
          </li>
        </Steps>
        <Alert severity="warning">
          If you change the public address, update the identity provider's settings to match, or single sign-on stops
          working. Square's webhook URL changes too, unless you set one explicitly under Integrations.
        </Alert>
      </>
    ),
  },
  {
    id: 'pricing-and-payments',
    title: 'Setting up pricing and payments',
    permission: 'payments.manage',
    body: (
      <>
        <Para>
          Open <strong>Admin</strong> and select <strong>Payments</strong> to decide how drivers are charged and who
          collects the money. When a charging session ends, the app works out the amount and creates a charge. If a
          payment provider is set, the driver gets a link to pay.
        </Para>
        <Typography variant="h6" gutterBottom>
          Choose how to charge
        </Typography>
        <Para>
          <strong>By time</strong> bills the minutes the car is connected. Every started minute is billed. Time-based
          billing does not measure the energy delivered, so a nearly full battery pays the same per minute as an empty
          one. Some places require charging to be billed by energy. Check your local rules first.
        </Para>
        <Para>
          To charge different prices at different times, add <strong>time windows</strong>. For example, a lower price on
          Saturday and Sunday, or a higher one from 17:00 to 21:00. Each window has its own price per minute, and the base
          price applies to every other minute. Windows cannot overlap. A window can run past midnight, such as 22:00 to
          06:00.
        </Para>
        <Para>
          <strong>By power dispensed</strong> bills per kWh, based on the charger's meter reading. One price applies to all
          energy.
        </Para>
        <Para>
          <strong>Don't charge drivers</strong> makes charging free. Sessions are still recorded, as No charge.
        </Para>
        <Typography variant="h6" gutterBottom>
          Check the price
        </Typography>
        <Para>
          Open the <strong>Rate calculator</strong> and enter what the energy costs you: the grid price, any distribution
          charge, your monthly charges, and your solar capacity if you have it. The calculator works out the cost of each
          kWh and adds your profit margin. The <strong>price check</strong> compares the highest price a driver pays with
          that cost, and warns when the price is far above it. The warning is stronger for Level 2 chargers, where a
          high rate is more often a typing mistake. You can still save a high rate after you confirm it.
        </Para>
        <Typography variant="h6" gutterBottom>
          Card hold before charging
        </Typography>
        <Para>
          Optionally, set an amount to <strong>hold on the driver's card</strong> before a waitlisted driver starts. The
          hold is not a charge. When the session ends, the driver is charged its actual cost, up to the hold, and the rest
          is released. Holds need Stripe or Braintree. A driver who has not placed the hold when they are called cannot
          start, so only use this when you are comfortable asking drivers to do that first.
        </Para>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Power metering depends on what the station supports. Some stations report readings inaccurately or not at all,
          so the amount may not match the energy delivered. Also check your local laws and ordinances on whether reselling
          power is allowed. Many places restrict it or need a license. The app asks you to confirm this before it saves
          power-based pricing.
        </Alert>
        <Typography variant="h6" gutterBottom>
          Connect a payment provider
        </Typography>
        <Para>
          Pick <strong>Stripe</strong>, <strong>Braintree</strong>, or <strong>Square</strong> once its keys are saved under Integrations. Each provider shows
          whether it's <em>Configured</em>. Follow its setup guide to get the keys:
        </Para>
        <Steps>
          <li><RouterLink to="/help/stripe-setup">Set up Stripe</RouterLink></li>
          <li><RouterLink to="/help/braintree-setup">Set up Braintree</RouterLink></li>
        </Steps>
        <Para>
          The app never asks for card numbers. Stripe and Braintree collect them on their own secure forms, so this
          server never handles card details.
        </Para>
        <Typography variant="h6" gutterBottom>
          Read the charges list
        </Typography>
        <Steps>
          <li><strong>Awaiting payment</strong>: the driver hasn't paid yet.</li>
          <li><strong>Paid</strong>: the provider confirmed the payment.</li>
          <li><strong>Needs review</strong>: the session had no usable meter reading, so nothing was billed. Check the station.</li>
          <li><strong>No charge</strong>: the session came to zero.</li>
        </Steps>
        <Alert severity="info">
          Charges are recorded even with no provider set, so you can see what you would have billed.
        </Alert>
      </>
    ),
  },
  {
    id: 'stripe-setup',
    title: 'Setting up Stripe',
    permission: 'payments.manage',
    body: (
      <>
        <Para>
          Stripe takes card payments on its own hosted checkout page. Drivers are sent there from their payment link, and
          this server only receives a confirmation. Work through these steps once. Use test mode until everything works.
        </Para>
        <Typography variant="h6" gutterBottom>
          1. Create a Stripe account
        </Typography>
        <Steps>
          <li>Sign up at stripe.com and finish the business details Stripe asks for.</li>
          <li>Turn on <strong>Test mode</strong> with the toggle in the Stripe dashboard. Test mode uses fake money.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          2. Copy your secret key
        </Typography>
        <Steps>
          <li>In the Stripe dashboard, open <strong>Developers</strong>, then <strong>API keys</strong>.</li>
          <li>Copy the <strong>Secret key</strong>. It starts with <code>sk_test_</code> in test mode.</li>
          <li>Never paste this key into the web app or share it. Anyone with it can move money in your account.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          3. Create a webhook endpoint
        </Typography>
        <Para>
          The webhook is how Stripe tells this server a payment finished. Stripe signs each message, and the server checks
          that signature.
        </Para>
        <Steps>
          <li>Open <strong>Developers</strong>, then <strong>Webhooks</strong>, and select <strong>Add endpoint</strong>.</li>
          <li>
            For the endpoint URL, enter your server's public address followed by{' '}
            <code>/api/payments/stripe/webhook</code>, for example <code>https://ev.example.com/api/payments/stripe/webhook</code>.
          </li>
          <li>Select the event <strong>checkout.session.completed</strong>, then save.</li>
          <li>Open the endpoint and copy its <strong>Signing secret</strong>. It starts with <code>whsec_</code>.</li>
        </Steps>
        <Alert severity="info" sx={{ mb: 2 }}>
          Testing on your own computer? Install the Stripe CLI and run{' '}
          <code>stripe listen --forward-to localhost:4000/api/payments/stripe/webhook</code>. It prints a signing secret
          that starts with <code>whsec_</code> for local use.
        </Alert>
        <Typography variant="h6" gutterBottom>
          4. Add the keys in the admin app
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Integrations</strong>, and find the Stripe section.</li>
          <li>Paste the <strong>Secret key</strong> and the <strong>Webhook signing secret</strong>.</li>
          <li>Select <strong>Save Stripe</strong>, then <strong>Test connection</strong> to check the keys.</li>
        </Steps>
        <Para>
          Keys are saved in the database and encrypted, so you never edit a server file. Once saved, a key can't be
          viewed again, only replaced or cleared. The web app's address, which Stripe uses to send drivers back after they
          pay, is set under <strong>Admin</strong>, then <strong>System</strong>.
        </Para>
        <Typography variant="h6" gutterBottom>
          5. Turn it on and test
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Payments</strong>. Stripe should show <em>Configured</em>.</li>
          <li>Choose <strong>Stripe</strong> under Payment provider, then select <strong>Save payment settings</strong>.</li>
          <li>
            Open a payment link and pay with the test card <code>4242 4242 4242 4242</code>, any future date, and any
            three-digit code. The charge should change to <em>Paid</em> within a few seconds.
          </li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          6. Go live
        </Typography>
        <Steps>
          <li>Finish Stripe's account activation so live payments are allowed.</li>
          <li>Create a live secret key and a live webhook endpoint, then paste their keys into Admin, then Integrations.</li>
          <li>Restart the server and make a small real payment to confirm.</li>
        </Steps>
        <Alert severity="warning">
          Webhooks need a public HTTPS address. Stripe can't reach <code>localhost</code>, so use the Stripe CLI while
          testing on your own computer.
        </Alert>
      </>
    ),
  },
  {
    id: 'square-setup',
    title: 'Setting up Square',
    permission: 'payments.manage',
    body: (
      <>
        <Para>
          Square takes card payments on its own hosted checkout page. Drivers are sent there from their payment link, and
          this server only receives a confirmation. Start with the sandbox environment, which uses test money.
        </Para>
        <Typography variant="h6" gutterBottom>
          1. Create a Square developer application
        </Typography>
        <Steps>
          <li>Sign in at developer.squareup.com and create an application.</li>
          <li>Open the application's <strong>Sandbox</strong> tab for test credentials.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          2. Copy your access token and location ID
        </Typography>
        <Steps>
          <li>On the Sandbox tab, copy the <strong>Sandbox access token</strong>. Keep it secret.</li>
          <li>
            Find the location ID for the site that takes payments. In the Square Dashboard, open{' '}
            <strong>Locations</strong>. The Square developer dashboard can also list your locations.
          </li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          3. Create a webhook subscription
        </Typography>
        <Para>
          The webhook tells this server when a payment completes. Square signs each message, and the server checks that
          signature before it changes anything.
        </Para>
        <Steps>
          <li>In the developer dashboard, open the application's <strong>Webhooks</strong> page and add a subscription.</li>
          <li>
            For the notification URL, enter your server's public address followed by{' '}
            <code>/api/payments/square/webhook</code>. It must match the <strong>Webhook notification URL</strong> you set under Integrations
            exactly, if you set one.
          </li>
          <li>Subscribe to the event <strong>payment.updated</strong>.</li>
          <li>Copy the <strong>Signature key</strong> shown for the subscription.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          4. Add the keys in the admin app
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Integrations</strong>, and find the Square section.</li>
          <li>Choose <strong>Sandbox</strong> as the environment, then paste the access token, location ID, and webhook signature key.</li>
          <li>Select <strong>Save Square</strong>, then <strong>Test connection</strong> to check the keys.</li>
        </Steps>
        <Para>
          Keys are saved encrypted in the database, so you never edit a server file. Once saved, a key can't be viewed
          again, only replaced or cleared. Set the web app's address under <strong>Admin</strong>, then <strong>System</strong>.
        </Para>
        <Typography variant="h6" gutterBottom>
          5. Turn it on and test
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Payments</strong>. Square should show <em>Configured</em>.</li>
          <li>Choose <strong>Square</strong> under Payment provider, then select <strong>Save payment settings</strong>.</li>
          <li>
            Open a payment link and pay with the sandbox test card <code>4111 1111 1111 1111</code>, any future expiry date,
            and any CVV. The charge should change to <em>Paid</em> within a few seconds.
          </li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          6. Go live
        </Typography>
        <Steps>
          <li>Apply for production access in the developer dashboard and finish Square's account activation.</li>
          <li>
            Copy the <strong>Production</strong> access token, your production location ID, and the production webhook
            signature key. In the Square section of Integrations, choose <strong>Production</strong> and save.
          </li>
          <li>Make a small real payment to confirm.</li>
        </Steps>
        <Alert severity="info" sx={{ mb: 2 }}>
          Apple Pay and Google Pay appear on Square's checkout page only when Square enables them for your account and
          the driver's device supports them. Square's own documentation explains what your account needs.
        </Alert>
        <Alert severity="warning">
          Webhooks need a public HTTPS address, so Square can't reach <code>localhost</code>. Test with the sandbox on
          your own computer, or use a tunnel that gives you a public HTTPS address.
        </Alert>
      </>
    ),
  },
  {
    id: 'braintree-setup',
    title: 'Setting up Braintree',
    permission: 'payments.manage',
    body: (
      <>
        <Para>
          Braintree takes card payments inside a form on the payment page. The card details go straight to Braintree,
          which returns a one-time payment token, and this server charges that token. Work through these steps with a
          sandbox account first.
        </Para>
        <Typography variant="h6" gutterBottom>
          1. Create a sandbox account
        </Typography>
        <Steps>
          <li>Sign up for a Braintree sandbox account at sandbox.braintreegateway.com.</li>
          <li>Finish the setup steps shown on the dashboard.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          2. Copy your merchant ID and API keys
        </Typography>
        <Steps>
          <li>Sign in to the Braintree Control Panel and open your account settings.</li>
          <li>Find your <strong>Merchant ID</strong>. Search the Control Panel for "Merchant ID" if you can't find it.</li>
          <li>
            Open <strong>API keys</strong> and generate a new key. Copy the <strong>Public key</strong> and{' '}
            <strong>Private key</strong>. Braintree shows the private key only once, so save it somewhere safe.
          </li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          3. Add the keys in the admin app
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Integrations</strong>, and find the Braintree section.</li>
          <li>Choose <strong>Sandbox</strong>, then enter the merchant ID, public key, and private key.</li>
          <li>Select <strong>Save Braintree</strong>, then <strong>Test connection</strong> to check the keys.</li>
        </Steps>
        <Para>
          Keys are saved encrypted in the database, so you never edit a server file. Once saved, the private key can't be
          viewed again, only replaced or cleared.
        </Para>
        <Typography variant="h6" gutterBottom>
          4. Turn it on and test
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Payments</strong>. Braintree should show <em>Configured</em>.</li>
          <li>Choose <strong>Braintree</strong> under Payment provider, then select <strong>Save payment settings</strong>.</li>
          <li>
            Open a payment link. The card form appears on the page. Pay with the sandbox card{' '}
            <code>4111 1111 1111 1111</code>, any future expiry date, and any CVV.
          </li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          5. Go live
        </Typography>
        <Steps>
          <li>Create a production account at braintreegateway.com and finish its approval. Braintree must approve it first.</li>
          <li>Create production keys and your production merchant ID.</li>
          <li>
            Choose <strong>Production</strong> in the Braintree section of Admin, then Integrations, and enter the production keys.
          </li>
        </Steps>
        <Alert severity="warning" sx={{ mb: 2 }}>
          The currency on the Payments tab must match the currency of your Braintree merchant account. Braintree charges
          in its account currency and doesn't convert.
        </Alert>
        <Alert severity="info">
          Keep the private key secret. Anyone with it can run transactions on your account.
        </Alert>
      </>
    ),
  },
];
