import { ProviderSettingsPage } from '../components/ProviderSettingsPage.jsx';

const EMAIL_CONFIG = {
  endpoint: '/api/admin/email',
  title: 'E-mail server',
  intro: 'How e-mail to drivers is sent: through your own mail server, or through a mail delivery service.',
  notice:
    'Until e-mail is connected, messages are written to the server log instead of being sent. The wording of each message is set on the Message templates page.',
  providerKey: 'email.provider',
  providerLabel: 'Send e-mail using',
  providerHeading: 'Provider',
  providers: [
    { value: 'NONE', label: 'Not connected (write to the server log)' },
    { value: 'SMTP', label: 'Your own SMTP server' },
    { value: 'SES', label: 'Amazon SES' },
    { value: 'POSTMARK', label: 'Postmark' },
    { value: 'SENDGRID', label: 'SendGrid' },
  ],
  common: [
    {
      key: 'email.fromAddress',
      label: 'From address',
      help: 'Drivers see this address. Use one on a domain your provider is allowed to send for.',
    },
    { key: 'email.fromName', label: 'From name (optional)', help: 'For example, the name of your car park.' },
  ],
  byProvider: {
    SMTP: [
      { key: 'email.smtp.host', label: 'SMTP server' },
      { key: 'email.smtp.port', label: 'Port', help: 'Usually 587 (STARTTLS), 465 (TLS) or 25.' },
      {
        key: 'email.smtp.secure',
        label: 'Encryption',
        options: [
          { value: 'STARTTLS', label: 'STARTTLS (port 587)' },
          { value: 'TLS', label: 'TLS (port 465)' },
          { value: 'NONE', label: 'None (not recommended)' },
        ],
      },
      { key: 'email.smtp.username', label: 'Username (if the server needs one)' },
      { key: 'email.smtp.password', label: 'Password (if the server needs one)', secret: true },
    ],
    SES: [
      { key: 'email.ses.region', label: 'AWS region', help: 'For example, us-east-1.' },
      { key: 'email.ses.accessKeyId', label: 'Access key ID' },
      {
        key: 'email.ses.secretAccessKey',
        label: 'Secret access key',
        secret: true,
        help: 'An IAM user that may call ses:SendEmail.',
      },
    ],
    POSTMARK: [{ key: 'email.postmark.serverToken', label: 'Server API token', secret: true }],
    SENDGRID: [{ key: 'email.sendgrid.apiKey', label: 'API key', secret: true, help: 'Needs permission to send mail.' }],
  },
  testLabel: 'Send the test to',
  testPlaceholder: 'you@example.com',
};

export function AdminEmailPage() {
  return <ProviderSettingsPage config={EMAIL_CONFIG} />;
}
