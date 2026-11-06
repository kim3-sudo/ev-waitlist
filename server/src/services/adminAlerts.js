import { prisma } from '../db.js';
import { siteConfig } from './runtimeConfig.js';
import { deliverEmail, emailProblem } from './channels/email.js';

// Alerts for admins about charge points. Each admin chooses, on their account page,
// which alerts they get (alertOnFault, alertOffline). Nobody else is notified.
// Sent by e-mail through the site's e-mail provider. When e-mail isn't connected, the
// alert is written to the server log, as driver messages are.

const FLAG = { FAULT: 'alertOnFault', OFFLINE: 'alertOffline' };

export async function notifyAdmins(kind, subject, body) {
  const flag = FLAG[kind];
  if (!flag) throw new Error(`Unknown alert kind: ${kind}`);
  const admins = await prisma.admin.findMany({ where: { [flag]: true }, orderBy: { email: 'asc' } });
  const cfg = siteConfig().email;
  const problem = emailProblem(cfg);
  for (const admin of admins) {
    if (problem) {
      console.log(`[alert -> ${admin.email}] (e-mail not sent: ${problem}) ${subject}: ${body}`);
      continue;
    }
    try {
      await deliverEmail(cfg, { to: admin.email, subject, text: body });
    } catch (err) {
      console.error(`[alert -> ${admin.email}] e-mail not sent: ${err.message}`);
    }
  }
  return admins.length;
}
