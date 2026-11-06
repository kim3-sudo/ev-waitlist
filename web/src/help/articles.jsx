import { Alert, Box, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

// Help articles. `permission` (optional) is the permission key a role needs to see
// the article. Articles without one are visible to everyone who can sign in.
// HELP_SECTIONS groups the articles in the left-hand list, in this order.
// Write in the second person, with a friendly tone and the active voice.

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

export const HELP_SECTIONS = [
  { title: 'Getting started', ids: ['your-role', 'your-profile'] },
  {
    title: 'Charge points',
    ids: ['view-charge-points', 'add-charge-point', 'test-connection', 'update-charge-point', 'remove-charge-point', 'charge-point-status'],
  },
  {
    title: 'Waitlist and drivers',
    ids: ['plate-regions', 'message-templates', 'line-cutting-complaints', 'generate-reports'],
  },
  { title: 'Notifications', ids: ['notification-setup', 'driver-text-messages'] },
  { title: 'Payments', ids: ['pricing-and-payments', 'stripe-setup', 'square-setup', 'braintree-setup'] },
  { title: 'Roaming (OCPI)', ids: ['roaming-drivers', 'roaming-partners'] },
  { title: 'Privacy', ids: ['privacy-retention'] },
  { title: 'Sites', ids: ['multiple-sites'] },
  {
    title: 'Administration',
    ids: ['manage-users', 'custom-roles', 'system-settings', 'branding-fonts', 'integrations'],
  },
];

export const HELP_ARTICLES = [
  {
    id: 'your-role',
    title: 'Understanding your role',
    body: (
      <>
        <Para>
          Every account has a role. Your role decides what you can change, and you see only the parts of the app it
          allows.
        </Para>
        <Para>
          <strong>Admin</strong> is built in and can do everything. <strong>Viewer</strong> is built in and can read
          charge points, zones, complaints, and reports, but can't change them. Your administrator can also create custom
          roles, such as Electrician, with exactly the permissions you need. See <em>Creating custom roles</em> for
          details.
        </Para>
        <Alert severity="info">
          Need a different role? Ask an admin to change it for you under Admin, then Users.
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
          password, then your new one. If you sign in through single sign-on, you have no password to change.
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
            On <strong>Connectors</strong>, set the number of plugs on the charger. Then fill in each connector's details:
            the standard, format, power type, and maximum volts and amps. Drivers see these on the waitlist, and roaming
            partners need them to find your charger. You can skip them now and add them later.
          </li>
          <li>On <strong>Review</strong>, check the details and select <strong>Save charge point</strong>.</li>
          <li>
            On <strong>Connect</strong>, point the charger at the address shown. The status changes to{' '}
            <strong>Connected</strong> once the charger reaches the app. Then select <strong>Test connection</strong>.
          </li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          Choose a connector standard
        </Typography>
        <Para>
          Each choice shows a friendly name, such as <em>SAE J1772 Type 1</em>. Under it you'll find the code the app
          stores, such as <code>IEC_62196_T1</code>, and other names for the same plug, such as <em>J1772</em>. Match the
          label on your charger, and check the code if you're unsure.
        </Para>
        <Para>
          Tesla connectors use the same plug for AC and DC charging. Set the power type to match how that connector charges.
        </Para>
        <Para>
          Prefer a single form? Select <strong>Use the full form</strong> on the first step. The full form has the same
          fields on one page, including the connector details.
        </Para>
        <Alert severity="success">
          Once the charger connects, its row shows <strong>Online</strong>. If it stays offline, check that the identity
          matches exactly.
        </Alert>
      </>
    ),
  },
  {
    id: 'test-connection',
    title: 'Testing a connection',
    permission: 'stations.manage',
    body: (
      <>
        <Para>
          The test checks that your charger is connected, that it answers the app, and that the app can control it. It takes
          the charger out of service for a moment, checks that the charger reports it, and then returns it to service.
          Each step appears as it runs, with a green check when it passes or a red cross when it fails.
        </Para>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Run the test when nobody is charging on this charger. The app refuses to take a charger out of service during a
          session, and it always tries to bring the charger back into service, even if a step fails.
        </Alert>
        <Typography variant="h6" gutterBottom>
          Run the test
        </Typography>
        <Steps>
          <li>
            In the wizard, select <strong>Test connection</strong> on the last step, after the charger has connected.
          </li>
          <li>
            In the full form, open the charge point from the list. Under <strong>Connection</strong>, select{' '}
            <strong>Test connection</strong>. You can test only a charge point that's already saved.
          </li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          What each step checks
        </Typography>
        <Steps>
          <li><strong>Connected to the app</strong>: the charger has reached the app. If this fails, check the identity and the address the charger uses.</li>
          <li><strong>Answers a request</strong>: the charger replies to a configuration request within ten seconds.</li>
          <li><strong>Taken out of service</strong>: the app asks the charger to stop accepting drivers.</li>
          <li><strong>Reports it is unavailable</strong>: the charger reports its new status back to the app.</li>
          <li><strong>Returned to service</strong>: the app asks the charger to accept drivers again.</li>
          <li><strong>Reports it is back in service</strong>: the charger reports its status back to the app.</li>
        </Steps>
        <Para>
          If a step fails, the steps after it still run where they can, and the charger is returned to service. Read the
          message under the failed step, fix the cause, and run the test again.
        </Para>
        <Alert severity="info">
          The test doesn't start a charging session or change any settings on the charger. It only changes whether the charger
          accepts drivers, and only for a moment.
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
          Change a charge point's details when something about it changes, such as its name, location, zone, or connectors.
        </Para>
        <Steps>
          <li>Open <strong>Admin</strong> and find the charge point in the list.</li>
          <li>Select the edit icon in that row.</li>
          <li>
            Change the details you need. To update a connector, change its standard, format, power type, or maximum volts
            and amps.
          </li>
          <li>Select <strong>Save</strong>, then <strong>Test connection</strong> to confirm the charger still answers.</li>
        </Steps>
        <Alert severity="warning" sx={{ mb: 2 }}>
          If you change the identity, update the charger's settings to match. Otherwise, the charger can't connect.
        </Alert>
        <Para>
          A charge point in a zone shares one waitlist with the rest of that zone. If you move it to another zone, you change
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
    id: 'plate-regions',
    title: 'Choosing license plate places and identifiers',
    permission: 'branding.manage',
    body: (
      <>
        <Para>
          You decide what the join form asks drivers for. It can ask for a license plate, a parking permit, or either one.
          When it asks for a plate, it also asks where the plate was issued, so the same number from two places isn't
          confused.
        </Para>
        <Typography variant="h6" gutterBottom>
          Choose the places to offer
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Waitlist</strong>.</li>
          <li>
            Under <strong>License plates</strong>, tick the sets you need: US states, Canadian provinces and territories,
            or European Union countries. Tick only the sets your drivers use.
          </li>
          <li>
            To add a place that isn't in a set, type it under <strong>Other places</strong>, one per line, as a code and a
            name, for example <code>MX-CMX, Mexico City</code>. Codes can use letters, digits, and hyphens, up to 12
            characters.
          </li>
          <li>
            Choose a <strong>Default place</strong>. Drivers see it selected first, and they can change it.
          </li>
          <li>Select <strong>Save settings</strong>.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          Choose what drivers enter
        </Typography>
        <Para>
          Under <strong>Waitlist identifiers</strong>, choose whether drivers must enter a license plate, a parking permit, or
          either one. Select <strong>Save settings</strong> to apply the change to the join form.
        </Para>
        <Alert severity="info">
          Removing a place stops it from showing on the join form. Drivers who already joined keep their place until your
          retention settings clear their details.
        </Alert>
      </>
    ),
  },
  {
    id: 'message-templates',
    title: 'Changing the messages drivers receive',
    permission: 'branding.manage',
    body: (
      <>
        <Para>
          The app sends drivers a few messages: when their charger is ready, when they should move their car, when they are
          next in line, and when they owe a payment. Open <strong>Admin</strong>, then <strong>Message templates</strong>, to
          change the wording of any of them.
        </Para>
        <Steps>
          <li>Select <strong>Edit</strong> on the message you want to change.</li>
          <li>Change the <strong>Subject</strong> and the <strong>Message</strong>. The subject is a short title.</li>
          <li>
            Placeholders such as <code>{'{station}'}</code> are filled in when the message is sent. Select a placeholder to add
            it to the message. The preview shows the message with example values.
          </li>
          <li>Select <strong>Save message</strong>.</li>
        </Steps>
        <Para>
          Each message stays in the built-in wording until you change it. To go back to the built-in wording, open the message
          and select <strong>Reset to built-in text</strong>.
        </Para>
        <Para>
          Each message also has a text message wording, for drivers who choose text messages. Change it in the{' '}
          <strong>Text message</strong> box. Text messages are limited to 480 characters.
        </Para>
        <Alert severity="info">
          A message can only use the placeholders listed for it. The app refuses a message that uses any other placeholder,
          so a driver never sees a placeholder name by mistake.
        </Alert>
      </>
    ),
  },
  {
    id: 'notification-setup',
    title: 'Connecting e-mail and text messages',
    permission: 'integrations.manage',
    body: (
      <>
        <Para>
          Messages reach drivers by e-mail, and by text message for drivers who choose it. Until a service is connected, the
          app writes each message to the server log instead of sending it. Connect both under <strong>Admin</strong>, in{' '}
          <strong>Notification integrations</strong>.
        </Para>
        <Steps>
          <li>
            Open <strong>E-mail server</strong>. Choose how to send: your own SMTP server, Amazon SES, Postmark or SendGrid.
            Fill in the fields for that choice, and set the <strong>From address</strong>.
          </li>
          <li>Select <strong>Save settings</strong>, then send a test to your own address.</li>
          <li>
            Open <strong>SMS service</strong>. Choose <strong>Twilio</strong> and enter the account SID, auth token and the
            number or Messaging Service to send from. Save, then send a test to your mobile number.
          </li>
        </Steps>
        <Para>
          Once a text message service is connected, the waitlist join form offers drivers a tick box to also send them text
          messages. They give a mobile number with its country code. Drivers who don&apos;t tick it get e-mail only.
        </Para>
        <Alert severity="info">
          Secrets such as passwords and API keys are stored encrypted, and are never shown again after you save them. They need
          CONFIG_ENCRYPTION_KEY to be set in the project .env file.
        </Alert>
      </>
    ),
  },
  {
    id: 'driver-text-messages',
    title: 'Text messages for waitlist drivers',
    body: (
      <>
        <Para>
          Drivers always get their messages by e-mail. When you have connected a text message service, drivers can also choose
          to get them by text. This article explains what drivers see, what they receive, and what happens to their number.
          Set up the services first, as described in <strong>Connecting e-mail and text messages</strong>.
        </Para>
        <Typography variant="h6" gutterBottom>
          What drivers see on the join form
        </Typography>
        <Steps>
          <li>
            Drivers enter their name and an email address. With text messages off, the contact field accepts only an email
            address, so a phone number is refused.
          </li>
          <li>
            With text messages on, the contact field reads <strong>Email or phone</strong>, and a tick box reads{' '}
            <strong>Also send me text messages</strong>.
          </li>
          <li>
            If the driver ticks the box, a <strong>Mobile number</strong> field appears. It asks for the number with its country
            code, such as +1 555 123 4567. The app refuses a number without one.
          </li>
          <li>If you have not connected a text message service, the tick box and the mobile number field stay hidden.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          Which messages go by text
        </Typography>
        <Para>
          A driver who ticked the box gets every message about their place in line by text as well as by e-mail. That includes
          the ready message, the move-your-vehicle message, the next-in-line message, and payment requests after a session. Each
          text uses the text message wording on the <strong>Message templates</strong> page. Texts are limited to 480
          characters.
        </Para>
        <Typography variant="h6" gutterBottom>
          What happens to the mobile number
        </Typography>
        <Para>
          The mobile number is stored with the driver's waitlist entry, and with the payer details on their charge. It follows
          the same rules as their other details. It is cleared when the waitlist period or the payer period ends, and when you
          erase the driver under <strong>Privacy</strong>. See <strong>Keeping drivers' details for the right time</strong>.
        </Para>
        <Typography variant="h6" gutterBottom>
          When a message doesn't arrive
        </Typography>
        <Steps>
          <li>
            Check the connection under <strong>Notification integrations</strong>. A service that is not connected, or whose
            settings are incomplete, writes each message to the server log instead of sending it.
          </li>
          <li>
            Look in the server log for a line that begins with <code>[notify -&gt;</code> and says <strong>not sent</strong>. It
            gives the reason.
          </li>
          <li>Send a test message from the e-mail or SMS page. If the test works, the problem is with that driver's details.</li>
        </Steps>
        <Alert severity="info">
          Drivers who choose text messages still get their e-mail. Text messages are an extra, not a replacement.
        </Alert>
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
          <li>Open <strong>Reports</strong>, then select <strong>Line-cutting complaints</strong>.</li>
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
          Use the reports under <strong>Reports</strong> to see how your chargers are used. Each one covers the period you choose.
        </Para>
        <Typography variant="h6" gutterBottom>
          Usage and idle time
        </Typography>
        <Para>
          This report shows how each charge point's connector time was spent: <strong>charging</strong> while a car drew power,
          <strong> waiting</strong> after charging finished while the car stayed plugged in, and <strong>free</strong> for the next
          driver. The bar shows the three shares, and the table shows the hours behind them. Use it to decide whether you need
          more chargers, or whether drivers leave their cars plugged in too long.
        </Para>
        <Typography variant="h6" gutterBottom>
          Energy dispensed
        </Typography>
        <Para>
          This report adds up the energy each charge point delivered, from the meter readings at the start and end of each
          session, and breaks it down by day. A session with no meter reading adds no energy, and the report counts it
          separately so you can see which chargers don't report their readings. If none of your sessions has a reading, the
          report says so.
        </Para>
        <Typography variant="h6" gutterBottom>
          Idle after charging
        </Typography>
        <Para>
          This report lists connectors where a car stayed plugged in after charging finished, over the last seven days.
          Set <strong>Flag after (minutes)</strong> to the wait you consider too long. Rows that reach that limit stand out.
          A row labeled <strong>Still idle</strong> means the car is still plugged in right now.
        </Para>
        <Typography variant="h6" gutterBottom>
          Complaints summary
        </Typography>
        <Para>
          This report shows line-cutting complaints for each station. Choose a window of seven, thirty, or ninety days.
          You'll see how many complaints each station received, how many are still open, and how long the oldest open one
          has waited. You'll also see how long a typical complaint takes to close.
        </Para>
        <Alert severity="info">Use the summary to spot stations that need attention before the problem grows.</Alert>
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
          Open <strong>Admin</strong> and select <strong>Payment settings</strong> to decide how drivers are charged and who
          collects the money. When a charging session ends, the app works out the amount and creates a charge. If you've
          set a payment provider, the driver gets a link to pay.
        </Para>
        <Typography variant="h6" gutterBottom>
          Choose how to charge
        </Typography>
        <Para>
          <strong>By time</strong> bills the minutes the car is connected. Every started minute is billed. Time-based
          billing doesn't measure the energy delivered, so a nearly full battery pays the same per minute as an empty one.
          Some places require charging to be billed by energy, so check your local rules first.
        </Para>
        <Para>
          To charge different prices at different times, add <strong>time windows</strong>. For example, you might set a
          lower price on Saturday and Sunday, or a higher one from 17:00 to 21:00. Each window has its own price per minute,
          and the base price applies to every other minute. Windows can't overlap. A window can run past midnight, such as
          22:00 to 06:00.
        </Para>
        <Para>
          <strong>By power dispensed</strong> bills per kWh, based on the charger's meter reading. One price applies to all
          energy.
        </Para>
        <Para>
          <strong>Don't charge drivers</strong> makes charging free. Sessions are still recorded, as No charge. A new site
          starts with free charging, so you choose a price before any driver is billed.
        </Para>
        <Para>
          For time-based pricing, choose whether the base price is per <strong>minute</strong> or per <strong>hour</strong>.
          With per minute, every started minute is billed. With per hour, every started hour is billed, so a session of one
          hour and ten minutes pays for two hours. Switching the unit converts the prices you have typed, but check them
          afterwards.
        </Para>
        <Typography variant="h6" gutterBottom>
          Check the price
        </Typography>
        <Para>
          Select <strong>Open calculator</strong> to open the energy cost calculator. Enter what the energy costs you: the grid
          price, any distribution charge, your monthly charges, and your solar capacity if you have it. The calculator works
          out the cost of each kWh and adds your profit margin. Your entries save themselves as you type, so you can close the
          window at any time. Until you enter your own figures, the calculator uses conservative starting values, with higher
          costs than a typical bill, so the price stays on the safe side. The <strong>price check</strong> compares the highest price a driver pays with
          that cost, and warns you when the price is far above it. The warning is stronger for Level 2 chargers, where a
          high rate is more often a typing mistake. You can still save a high rate after you confirm it.
        </Para>
        <Typography variant="h6" gutterBottom>
          Card hold before charging
        </Typography>
        <Para>
          You can set an amount to <strong>hold on the driver's card</strong> before a waitlisted driver starts. The hold
          isn't a charge. When the session ends, the driver is charged its actual cost, up to the hold, and the app releases
          the rest. Holds need Stripe or Braintree. A driver who hasn't placed the hold when they're called can't start, so
          use this only when you're comfortable asking drivers to do that first.
        </Para>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Power metering depends on what the station supports. Some stations report readings inaccurately or not at all,
          so the amount may not match the energy delivered. Check your local laws on whether reselling power is allowed.
          Many places restrict it or require a license. The app asks you to confirm this before it saves power-based
          pricing.
        </Alert>
        <Typography variant="h6" gutterBottom>
          Connect a payment provider
        </Typography>
        <Para>
          Open <strong>Admin</strong>, then <strong>Payment providers</strong>, and save the keys for the provider you want. Once
          a provider shows <em>Configured</em>, choose it under Payments. Follow the setup guide for that provider:
        </Para>
        <Steps>
          <li><RouterLink to="/help/stripe-setup">Set up Stripe</RouterLink></li>
          <li><RouterLink to="/help/square-setup">Set up Square</RouterLink></li>
          <li><RouterLink to="/help/braintree-setup">Set up Braintree</RouterLink></li>
        </Steps>
        <Para>
          The app never asks for card numbers. Stripe, Square, and Braintree collect them on their own secure pages, so this
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
          The app records charges even when you haven't set a provider, so you can see what you would have billed.
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
          Stripe takes card payments on its own hosted checkout page. Drivers reach that page from their payment link, and
          this server only receives a confirmation. Work through these steps once, and use test mode until everything works.
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
            If this is a site other than your first one, use the webhook address shown for that site in the operator checklist.
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
          <li>Open <strong>Admin</strong>, then <strong>Payment providers</strong>, and find the Stripe section.</li>
          <li>Paste the <strong>Secret key</strong> and the <strong>Webhook signing secret</strong>.</li>
          <li>Select <strong>Save Stripe</strong>, then <strong>Test connection</strong> to check the keys.</li>
        </Steps>
        <Para>
          The app saves your keys encrypted in the database, so you never edit a server file. After you save a key, the app
          doesn't show it again. You can replace it or clear it. The web app's address, which Stripe uses to send drivers
          back after they pay, is set under <strong>Admin</strong>, then <strong>System</strong>.
        </Para>
        <Typography variant="h6" gutterBottom>
          5. Turn it on and test
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Payment settings</strong>. Stripe should show <em>Configured</em>.</li>
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
          Square takes card payments on its own hosted checkout page. Drivers reach that page from their payment link, and
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
            <code>/api/payments/square/webhook</code>. If you set a <strong>Webhook notification URL</strong> under
            Integrations, enter exactly that address instead.
          </li>
          <li>Subscribe to the event <strong>payment.updated</strong>.</li>
          <li>Copy the <strong>Signature key</strong> shown for the subscription.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          4. Add the keys in the admin app
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Payment providers</strong>, and find the Square section.</li>
          <li>Choose <strong>Sandbox</strong> as the environment, then paste the access token, location ID, and webhook signature key.</li>
          <li>Select <strong>Save Square</strong>, then <strong>Test connection</strong> to check the keys.</li>
        </Steps>
        <Para>
          The app saves your keys encrypted in the database, so you never edit a server file. After you save a key, the app
          doesn't show it again. You can replace it or clear it. Set the web app's address under <strong>Admin</strong>,
          then <strong>System</strong>.
        </Para>
        <Typography variant="h6" gutterBottom>
          5. Turn it on and test
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Payment settings</strong>. Square should show <em>Configured</em>.</li>
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
          Apple Pay and Google Pay appear on Square's checkout page only when Square enables them for your account and the
          driver's device supports them. Square's own documentation explains what your account needs.
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
          Braintree takes card payments inside a form on the payment page. The card details go straight to Braintree, which
          returns a one-time payment token, and this server charges that token. Work through these steps with a sandbox
          account first.
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
          <li>Open <strong>Admin</strong>, then <strong>Payment providers</strong>, and find the Braintree section.</li>
          <li>Choose <strong>Sandbox</strong>, then enter the merchant ID, public key, and private key.</li>
          <li>Select <strong>Save Braintree</strong>, then <strong>Test connection</strong> to check the keys.</li>
        </Steps>
        <Para>
          The app saves your keys encrypted in the database, so you never edit a server file. After you save the private key,
          the app doesn't show it again. You can only replace it or clear it.
        </Para>
        <Typography variant="h6" gutterBottom>
          4. Turn it on and test
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Payment settings</strong>. Braintree should show <em>Configured</em>.</li>
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
            Choose <strong>Production</strong> in the Braintree section of Integrations, then enter the production keys.
          </li>
        </Steps>
        <Alert severity="warning" sx={{ mb: 2 }}>
          The currency on the Payments tab must match the currency of your Braintree merchant account. Braintree charges in
          its account currency and doesn't convert.
        </Alert>
        <Alert severity="info">
          Keep the private key secret. Anyone with it can run transactions on your account.
        </Alert>
      </>
    ),
  },
  {
    id: 'roaming-drivers',
    title: 'Allowing roaming drivers',
    permission: 'roaming.manage',
    body: (
      <>
        <Para>
          Roaming lets drivers who use another e-mobility provider join your waitlist. It's off by default. Turning it on
          has a legal step, so take that step before you flip the switch.
        </Para>
        <Typography variant="h6" gutterBottom>
          Turn roaming on
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Roaming</strong>.</li>
          <li>
            Ask your own legal counsel to review the roaming terms and the warning text. Read the draft text yourself
            first, too.
          </li>
          <li>
            If you need to, add your own text under <strong>Additional text for this site</strong>. The required text
            stays, and drivers see your text after it.
          </li>
          <li>
            Tick <strong>I have had my legal counsel review the roaming terms and this warning text</strong>. The app
            records when you ticked it and who you are.
          </li>
          <li>Turn on <strong>Allow roaming drivers to join this site's waitlist</strong>.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          What drivers see
        </Typography>
        <Para>
          A driver sees the warning in the join dialog and must tick that they accept it before they join. Roaming
          drivers join the same waitlist as everyone else.
        </Para>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This software doesn't give legal advice. The draft text is a starting point, and your own counsel must review it.
        </Alert>
        <Alert severity="info">
          If you change the warning text, roaming turns off until you tick the acknowledgement again. You'll see that
          message on the Roaming page.
        </Alert>
      </>
    ),
  },
  {
    id: 'roaming-partners',
    title: 'Connecting roaming partners (OCPI)',
    permission: 'roaming.manage',
    body: (
      <>
        <Para>
          A roaming partner is another e-mobility provider whose drivers charge at your stations. You connect to each partner
          over OCPI 2.2.1, the open standard that the two systems use to talk to each other.
        </Para>
        <Typography variant="h6" gutterBottom>
          Before you start
        </Typography>
        <Steps>
          <li>
            Add your <strong>Country code</strong> and <strong>Party ID</strong> under <strong>Admin</strong>, then{' '}
            <strong>Sites</strong>, then select <strong>Save operator</strong>. Use the party ID your roaming scheme or
            agreement gives you. Don't make one up.
          </li>
          <li>
            Give each station its <strong>latitude and longitude</strong>, and complete every connector's details. A station
            without them stays off the partner's map.
          </li>
          <li>
            Make sure your server has a public HTTPS address. Partners reach it there, and a reverse proxy can handle the
            certificate.
          </li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          Invite a partner
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Roaming</strong>, and find <strong>Roaming partners</strong>.</li>
          <li>Enter the partner's name, then select <strong>Invite partner</strong>.</li>
          <li>
            Send the one-time registration token to the partner through a channel you trust, such as a phone call. The
            token works once.
          </li>
          <li>
            The partner registers with its own credentials. The app checks the partner's versions and endpoints, gives the
            partner a token for future requests, and sends the partner your stations and tariff.
          </li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          Watch the traffic
        </Typography>
        <Para>
          When a partner's driver starts charging, the app checks the driver's token when the charger asks to authorize it.
          If a waitlisted driver is waiting for that connector, the app doesn't give it to the roaming driver.
        </Para>
        <Para>
          If a partner is offline, the app keeps its messages and retries them, up to ten times. To send them straight away,
          select <strong>Send queued messages now</strong>.
        </Para>
        <Alert severity="warning">
          This software hasn't been certified with a real partner. Test each partner's connection with them before you let
          their drivers charge, and expect small differences in how each partner fills in the details.
        </Alert>
      </>
    ),
  },
  {
    id: 'privacy-retention',
    title: "Keeping drivers' details for the right time",
    permission: 'privacy.manage',
    body: (
      <>
        <Para>
          The app keeps personal details only as long as you need them. Open <strong>Admin</strong>, then{' '}
          <strong>Privacy</strong>, to set how long each kind of detail stays.
        </Para>
        <Typography variant="h6" gutterBottom>
          Set the two periods
        </Typography>
        <Steps>
          <li>
            <strong>Waitlist details</strong>: the number of days after a waitlist entry closes before its name, contact,
            mobile number for text messages, plate, place, and permit are cleared. The default is 30 days.
          </li>
          <li>
            <strong>Payer details on charges</strong>: the number of days before the payer's name, contact, and mobile number
            are cleared from a charge. The default is 30 days. You can choose to keep them indefinitely instead, but first check your own
            record-keeping duties.
          </li>
        </Steps>
        <Para>
          The app clears these details automatically once an hour. A charge keeps its amount and time, so your accounts stay
          complete. The app also clears the notes on complaints you have resolved or dismissed, after the waitlist period.
        </Para>
        <Para>
          Meter readings and the charge point history follow the waitlist period too, and they are deleted rather than
          cleared. When you erase a driver now, the app also asks every connected charge point to forget its cached ID tags.
        </Para>
        <Para>
          Admins can change their own alert choices. Those choices are kept on each admin account, and erasing a driver never
          changes them.
        </Para>
        <Para>
          If you want to set how long readings are kept, use the same waitlist period. If your duties need a longer record,
          check them before you change it.
        </Para>
        <Typography variant="h6" gutterBottom>
          Erase one driver now
        </Typography>
        <Para>
          If a driver asks you to delete their details, you don't need to wait. Under <strong>Erase one driver now</strong>,
          enter that driver's waitlist entry ID and select <strong>Erase now</strong>. The app clears their waitlist details,
          including their mobile number, and their payer details on their charges and holds.
        </Para>
        <Alert severity="info">
          The default periods are a starting point, not legal advice. Set them to match your own data-protection and
          accounting obligations.
        </Alert>
      </>
    ),
  },
  {
    id: 'multiple-sites',
    title: 'Running more than one site',
    permission: 'sites.manage',
    body: (
      <>
        <Para>
          One installation can run several sites for the same operator. Each site has its own waitlist, charge points,
          branding, payment keys, roaming switch, retention periods, and single sign-on settings. If you run one site, you
          don't need anything in this article.
        </Para>
        <Typography variant="h6" gutterBottom>
          Who can add sites
        </Typography>
        <Para>
          The installation administrator, the first administrator on the server, creates sites, adds administrators to them,
          and deletes them. You can delete a site only after it has no charge points, administrators, or history.
        </Para>
        <Typography variant="h6" gutterBottom>
          Add a site
        </Typography>
        <Steps>
          <li>Open <strong>Admin</strong>, then <strong>Sites</strong>, and fill in the form for a new site.</li>
          <li>
            Enter the <strong>Site name</strong>, then an <strong>Address (used in links)</strong>. Use letters, numbers,
            and hyphens only. You can't change the address later.
          </li>
          <li>Enter the email address of the site's first administrator, and a <strong>Starting passphrase</strong> for them.</li>
          <li>Select <strong>Create</strong>. Give the administrator the passphrase, and they sign in as usual. Their home is their site.</li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          Work in another site
        </Typography>
        <Para>
          The site selector at the top of the admin pages lets you move between sites. It appears only when you have more
          than one site. Drivers reach a site's waitlist at your public address, followed by <code>/t/</code> and the site's
          address.
        </Para>
        <Alert severity="info">
          Each site has its own payment webhook addresses. Find them in the operator checklist, under Webhook addresses.
        </Alert>
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
          <strong>Users and roles</strong>.
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
          two-factor authentication sets it up the next time they sign in.
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
          <li>Open <strong>Admin</strong>, select <strong>Users and roles</strong>, and find the <strong>Roles</strong> section.</li>
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
          have it, so ask an admin who does. The same rule applies when you edit or delete a role, and when you change or
          remove a user whose role has permissions you don't hold.
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
          the app. Your changes take effect straight away, with no server restart.
        </Para>
        <Steps>
          <li>
            <strong>Public address of this server</strong>: the address other systems use to reach this server, such as
            single sign-on and Square webhooks.
          </li>
          <li>
            <strong>Web app address</strong>: where drivers go to pay, and where Stripe and Square send them back after
            checkout.
          </li>
          <li>
            <strong>Allowed web origin</strong>: the address the admin web app is served from. The API accepts requests only
            from this address.
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
    id: 'branding-fonts',
    title: 'Choosing your brand and font',
    permission: 'branding.manage',
    body: (
      <>
        <Para>
          Your branding appears on the waitlist, the pay pages, and the admin app. Open <strong>Admin</strong>, then{' '}
          <strong>Branding</strong>, to change your company name, logo, colors, and font.
        </Para>
        <Typography variant="h6" gutterBottom>
          Pick a Google Font
        </Typography>
        <Steps>
          <li>
            Select the <strong>Font</strong> box and start typing. The list narrows as you type, and each name appears in
            its own typeface.
          </li>
          <li>Select a font. The preview below the box shows it with your waitlist text.</li>
          <li>
            Can't find your font? Type its name exactly as Google Fonts lists it. Use letters, digits, and spaces only.
          </li>
          <li>Select <strong>Save settings</strong>.</li>
        </Steps>
        <Para>
          To use the browser's own font instead, choose <strong>Default (system font)</strong>.
        </Para>
        <Alert severity="info">
          A Google Font loads from Google's servers. That means a driver's browser contacts Google when it opens your
          waitlist. If that matters for your privacy notice, choose the default font.
        </Alert>
        <Alert severity="info">
          Uploading your own font file isn't available yet.
        </Alert>
      </>
    ),
  },
  {
    id: 'integrations',
    title: 'Connecting payment providers',
    permission: 'integrations.manage',
    body: (
      <>
        <Para>
          Open <strong>Admin</strong>, then <strong>Payment providers</strong>, to connect your payment providers.
          Each site keeps its own keys.
        </Para>
        <Typography variant="h6" gutterBottom>
          Save a provider's keys
        </Typography>
        <Steps>
          <li>Find the provider's section, such as Stripe, Square, or Braintree.</li>
          <li>Enter the keys the provider gave you. Each field's help text tells you what to copy.</li>
          <li>Select <strong>Save</strong>. The section shows <em>Configured</em> once every required field has a value.</li>
          <li>Select <strong>Test connection</strong> to check the keys with the provider.</li>
        </Steps>
        <Para>
          The app encrypts each secret with your installation's encryption key before it saves it. After you save a secret,
          the app doesn't show it again. To change it, enter a new value. To remove it, select <strong>Clear</strong>, and
          select <strong>Undo</strong> if you change your mind before you save.
        </Para>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Keep a backup of the encryption key, which the server keeps with the installation's secrets. If the key changes,
          for example after a move to a new server without the backup, the app can't read the saved keys. You'll need to
          enter them again.
        </Alert>
        <Typography variant="h6" gutterBottom>
          Single sign-on
        </Typography>
        <Para>
          Single sign-on is set up separately, under <strong>Admin</strong>, then <strong>Single sign-on</strong>. It needs
          its own permission, and each site has its own settings.
        </Para>
        <Para>
          If you can see Integrations but can't change it, your role is read-only for integrations. Ask an admin who has
          the permission to make the change.
        </Para>
      </>
    ),
  },
  {
    id: 'charge-point-status',
    title: 'Watching and controlling a charge point',
    permission: 'stations.view',
    body: (
      <>
        <Para>
          Open <strong>Admin</strong>, then <strong>Charge points</strong>, and select the{' '}
          <strong>status</strong> icon on a charge point. You see whether it is online, when it was last heard from, what it
          reports about itself, and what has happened to it recently. The page refreshes every few seconds.
        </Para>
        <Typography variant="h6" gutterBottom>
          Set up alerts for yourself
        </Typography>
        <Steps>
          <li>
            Open your account, and find <strong>Charge point alerts</strong>.
          </li>
          <li>
            Turn on <strong>a fault</strong> to get an e-mail when a charge point reports one, or{' '}
            <strong>offline or silent</strong> to hear when a charge point drops off or stops reporting.
          </li>
        </Steps>
        <Para>
          Each admin chooses for themselves, so only the people you pick are told. Alerts need e-mail to be connected on the
          <strong> E-mail server</strong> page. Until then, the app writes each alert to the server log.
        </Para>
        <Typography variant="h6" gutterBottom>
          Meter readings and payments
        </Typography>
        <Para>
          A charge point that has a meter reports its readings while a car charges. The page shows the connector's energy,
          power and charge level when it reports them. Each session's energy is checked against the reading taken when it
          ends. A reading that is zero, that did not move while the car drew power, or that disagrees with the end-of-session
          reading is never billed on its own. Those sessions show as <strong>needs review</strong> on the Payments page, so
          you can decide what to charge.
        </Para>
        <Para>
          Under <strong>Payments</strong>, the <strong>Meter readings</strong> section sets how often the charge point reports,
          and how closely its readings must match the end-of-session reading. The defaults suit most sites.
        </Para>
        <Typography variant="h6" gutterBottom>
          Commands you can send
        </Typography>
        <Para>
          If your role includes <strong>Send commands to charge points</strong>, you can act on a charge point from its status
          page. Each command reports what the charge point answered, and is recorded in its history.
        </Para>
        <Steps>
          <li>
            <strong>Stop a session</strong> asks the charge point to end it. The session is complete once the charge point
            reports it.
          </li>
          <li>
            <strong>Unlock cable</strong> releases the cable lock on a connector. This ends a session in progress, so the app
            asks you to confirm first. Drivers end their own sessions from the vehicle, so use this only when a cable is stuck.
          </li>
          <li>
            <strong>Out of service</strong> takes a connector out of the waitlist's reach, and <strong>in service</strong>
            puts it back. Your choice is kept while the charge point is offline, so no driver is offered that connector.
          </li>
          <li>
            <strong>Hold this connector</strong> keeps a connector for one ID tag for a set number of minutes, with no waitlist
            entry. Only that ID tag can start a session there. Release the hold early if you no longer need it.
          </li>
          <li>
            <strong>Restart</strong> reboots the charge point. If sessions are in progress, the app asks you to confirm first.
          </li>
          <li>
            <strong>Ask the charge point</strong> makes it send one of its messages now, such as its meter readings. Use it when
            you don't want to wait for the next report.
          </li>
        </Steps>
        <Typography variant="h6" gutterBottom>
          Settings the charge point keeps
        </Typography>
        <Para>
          The <strong>Configuration</strong> section shows the settings the charge point keeps, and the time they were last read.
          Select <strong>Read from charge point</strong> to refresh them while it is connected. You can change the settings the
          app allows, such as the heartbeat and meter reading intervals. Read-only settings stay as they are.
        </Para>
        <Para>
          The app sets the meter reading interval for you when the charge point connects. If a charge point has no meter, its
          status says so, and its sessions are billed from the end-of-session reading alone.
        </Para>
      </>
    ),
  },
];
