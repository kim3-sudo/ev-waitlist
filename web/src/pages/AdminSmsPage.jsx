import { ProviderSettingsPage } from '../components/ProviderSettingsPage.jsx';

const SMS_CONFIG = {
  endpoint: '/api/admin/sms',
  title: 'SMS service',
  intro: 'Text messages to drivers who choose them when they join the waitlist.',
  notice:
    'Drivers are offered text messages only once a service is connected. Each message has its own text message wording on the Message templates page.',
  providerKey: 'sms.provider',
  providerLabel: 'Send text messages using',
  providerHeading: 'Provider',
  providers: [
    { value: 'NONE', label: 'Not connected' },
    { value: 'TWILIO', label: 'Twilio' },
  ],
  common: [],
  byProvider: {
    TWILIO: [
      { key: 'sms.twilio.accountSid', label: 'Account SID', help: 'Starts with AC.' },
      { key: 'sms.twilio.authToken', label: 'Auth token', secret: true },
      {
        key: 'sms.twilio.sender',
        label: 'Send from',
        help: 'A Twilio phone number such as +15551234567, or a Messaging Service SID that starts with MG.',
      },
    ],
  },
  testLabel: 'Send the test to (mobile number)',
  testPlaceholder: '+15551234567',
};

export function AdminSmsPage() {
  return <ProviderSettingsPage config={SMS_CONFIG} />;
}
