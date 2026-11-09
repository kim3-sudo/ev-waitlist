import { Button, Link, Stack, Typography } from '@mui/material';

// Telephone links use digits and a leading +, so "+1 (555) 123-4567" dials as +15551234567.
const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`;

// The charge point's tips (one per charge point when the target is a zone), then the
// site's contact details. Both come from the admin's settings.
export function HelpPanel({ tips = [], contacts }) {
  const emails = contacts?.emails ?? [];
  const phones = contacts?.phones ?? [];
  const contactFormUrl = contacts?.contactFormUrl ?? '';
  const hasContacts = emails.length > 0 || phones.length > 0 || Boolean(contactFormUrl);

  return (
    <Stack spacing={2.5}>
      {tips.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="subtitle2">Tips</Typography>
          {tips.map((tip) => (
            <Stack key={tip.stationName} spacing={0.25}>
              {tips.length > 1 && (
                <Typography variant="body2" fontWeight={600}>
                  {tip.stationName}
                </Typography>
              )}
              <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                {tip.text}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}

      <Stack spacing={1}>
        <Typography variant="subtitle2">Contact us</Typography>
        {!hasContacts && (
          <Typography variant="body2" color="text.secondary">
            No contact details have been added yet.
          </Typography>
        )}
        {emails.map((email) => (
          <Typography key={email} variant="body2">
            E-mail: <Link href={`mailto:${email}`}>{email}</Link>
          </Typography>
        ))}
        {phones.map((phone) => (
          <Typography key={phone} variant="body2">
            Phone: <Link href={telHref(phone)}>{phone}</Link>
          </Typography>
        ))}
        {contactFormUrl && (
          <Button size="small" variant="outlined" href={contactFormUrl} target="_blank" rel="noopener" sx={{ alignSelf: 'flex-start' }}>
            Open the contact form
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
