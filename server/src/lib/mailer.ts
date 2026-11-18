import nodemailer from 'nodemailer';
import { PRODUCT_NAME } from '../config/brand';
import { config } from '../config/env';
import { logger } from './logger';

const transport = config.smtp.host
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

async function sendMail(opts: { to: string; subject: string; html: string }): Promise<boolean> {
  if (!transport) {
    logger.info({ to: opts.to, subject: opts.subject }, 'SMTP not configured — email skipped');
    return false;
  }
  await transport.sendMail({ from: config.smtp.from, ...opts });
  logger.info({ to: opts.to, subject: opts.subject }, 'email sent');
  return true;
}

// HTML escaping

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shared shell

function shell(opts: {
  headerLabel: string;
  title: string;
  body: string;
  cta?: { label: string; href: string };
  note?: string;
}): string {
  const cta = opts.cta
    ? `<div style="text-align:center;margin-bottom:28px;">
         <a href="${opts.cta.href}" style="display:inline-block;background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;font-size:14px;font-weight:600;padding:14px 36px;border-radius:8px;text-decoration:none;letter-spacing:0.4px;">
           ${opts.cta.label}
         </a>
       </div>`
    : '';
  const note = opts.note
    ? `<p style="margin:20px 0 0;font-size:13px;color:#64748b;line-height:1.6;">${opts.note}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#0f172a;padding:48px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;max-width:560px;width:100%;">
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%);padding:36px 48px;text-align:center;">
            <div style="font-size:24px;font-weight:700;color:#fff;letter-spacing:-0.5px;">${PRODUCT_NAME}</div>
            <div style="font-size:11px;color:#bfdbfe;margin-top:6px;letter-spacing:2px;text-transform:uppercase;">${opts.headerLabel}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 48px 36px;">
            <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#f1f5f9;">${opts.title}</h2>
            ${opts.body}
            ${cta}
            ${note}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 48px 24px;border-top:1px solid #334155;text-align:center;">
            <p style="margin:0;font-size:12px;color:#475569;">© 2026 Intelligence Labs Inc. — do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#94a3b8;">${text}</p>`;
}

function infoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;white-space:nowrap;">${label}</td>
    <td style="padding:10px 16px;font-size:14px;color:#cbd5e1;">${value}</td>
  </tr>`;
}

function infoTable(rows: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="background:#0f172a;border-radius:8px;border:1px solid #334155;margin:0 0 24px;">
    ${rows}
  </table>`;
}

function securityNote(): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="background:#172554;border-radius:8px;border:1px solid #1e40af;margin:20px 0 0;">
    <tr>
      <td style="padding:14px 18px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#93c5fd;">
          <strong style="color:#bfdbfe;">Didn't make this change?</strong>
          Contact your administrator immediately.
        </p>
      </td>
    </tr>
  </table>`;
}

function welcomeHtml(orgName: string, domains: string, adminEmail: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Welcome to ${PRODUCT_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#0f172a;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" role="presentation"
               style="background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;max-width:560px;width:100%;">

          <!-- Header gradient bar -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e3a8a 0%,#3b82f6 100%);padding:40px 48px 36px;text-align:center;">
              <div style="font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                ${PRODUCT_NAME}
              </div>
              <div style="font-size:12px;color:#bfdbfe;margin-top:8px;letter-spacing:2px;text-transform:uppercase;">
                Organization Setup Complete
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 48px 32px;">
              <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#f1f5f9;">
                Welcome, Super Admin!
              </h2>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#94a3b8;">
                Your organization has been successfully configured on
                <strong style="color:#cbd5e1;">${PRODUCT_NAME}</strong>.
                You now have full access to the platform.
              </p>

              <!-- Org detail card -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                     style="background:#0f172a;border-radius:8px;border:1px solid #334155;margin-bottom:28px;">
                <tr>
                  <td style="padding:24px;">

                    <div style="margin-bottom:20px;">
                      <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">
                        Organization
                      </div>
                      <div style="font-size:17px;font-weight:600;color:#e2e8f0;">${orgName}</div>
                    </div>

                    <div style="border-top:1px solid #1e293b;padding-top:18px;margin-bottom:20px;">
                      <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">
                        Domains
                      </div>
                      <div style="font-size:14px;color:#cbd5e1;">${domains}</div>
                    </div>

                    <div style="border-top:1px solid #1e293b;padding-top:18px;">
                      <div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px;">
                        Admin Email
                      </div>
                      <div style="font-size:14px;color:#cbd5e1;">${adminEmail}</div>
                    </div>

                  </td>
                </tr>
              </table>

              <!-- Security note -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                     style="background:#172554;border-radius:8px;border:1px solid #1e40af;margin-bottom:36px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#93c5fd;">
                      <strong style="color:#bfdbfe;">Security reminder:</strong>
                      Keep your super admin credentials secure. Do not share your password
                      and ensure access is restricted to authorized personnel only.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <div style="text-align:center;">
                <a href="#"
                   style="display:inline-block;background:linear-gradient(135deg,#1e40af,#3b82f6);
                          color:#ffffff;font-size:14px;font-weight:600;padding:14px 36px;
                          border-radius:8px;text-decoration:none;letter-spacing:0.4px;">
                  Go to Dashboard →
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 48px 28px;border-top:1px solid #334155;text-align:center;">
              <p style="margin:0;font-size:12px;color:#475569;line-height:1.6;">
                © 2026 Intelligence Labs Inc.<br />
                This is an automated message — please do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// User-facing security emails

export async function sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
  await sendMail({
    to,
    subject: `Reset your ${PRODUCT_NAME} password`,
    html: shell({
      headerLabel: 'Password Reset',
      title: 'Reset your password',
      body: p(
        `We received a request to reset your password. Click the button below to choose a new one. This link expires in <strong style="color:#cbd5e1;">1 hour</strong>.`,
      ),
      cta: { label: 'Reset Password →', href: resetLink },
      note: "If you didn't request this, you can safely ignore this email — your password won't change.",
    }),
  });
}

export async function sendPasswordResetConfirmEmail(to: string): Promise<void> {
  await sendMail({
    to,
    subject: `Your ${PRODUCT_NAME} password has been reset`,
    html: shell({
      headerLabel: 'Security Notice',
      title: 'Password successfully reset',
      body:
        p('Your password was just reset. You can now log in with your new password.') +
        securityNote(),
    }),
  });
}

export async function sendPasswordChangedEmail(to: string): Promise<void> {
  await sendMail({
    to,
    subject: `Your ${PRODUCT_NAME} password was changed`,
    html: shell({
      headerLabel: 'Security Notice',
      title: 'Password changed',
      body: p('Your account password was successfully updated.') + securityNote(),
    }),
  });
}

export async function sendInviteEmail(
  to: string,
  displayName: string,
  inviteLink: string,
  orgName: string,
): Promise<boolean> {
  return sendMail({
    to,
    subject: `You're invited to ${esc(orgName)} on ${PRODUCT_NAME}`,
    html: shell({
      headerLabel: "You've been invited",
      title: `Hi ${esc(displayName)},`,
      body: p(
        `You've been invited to join <strong style="color:#cbd5e1;">${esc(orgName)}</strong> on ${PRODUCT_NAME}. Click the button below to set your password and activate your account. This invite link expires in <strong style="color:#cbd5e1;">7 days</strong>.`,
      ),
      cta: { label: 'Accept Invite →', href: inviteLink },
      note: "If you weren't expecting this, you can safely ignore it.",
    }),
  });
}

export async function sendWelcomeAfterActivationEmail(
  to: string,
  displayName: string,
  orgName: string,
  loginUrl: string,
): Promise<void> {
  await sendMail({
    to,
    subject: `Welcome to ${esc(orgName)} — your account is ready`,
    html: shell({
      headerLabel: 'Account Activated',
      title: `Welcome, ${esc(displayName)}!`,
      body: p(
        `Your account on <strong style="color:#cbd5e1;">${esc(orgName)}</strong> is now active. Use the button below to log in and get started.`,
      ),
      cta: { label: 'Go to Dashboard →', href: loginUrl },
    }),
  });
}

export async function sendAccountDeactivatedEmail(to: string, displayName: string): Promise<void> {
  await sendMail({
    to,
    subject: `Your ${PRODUCT_NAME} account has been deactivated`,
    html: shell({
      headerLabel: 'Account Update',
      title: `Hi ${esc(displayName)},`,
      body:
        p(
          `Your ${PRODUCT_NAME} account has been deactivated by an administrator. You will no longer be able to sign in.`,
        ) + p('If you believe this is a mistake, please contact your organization administrator.'),
    }),
  });
}

export async function sendAccountReactivatedEmail(
  to: string,
  displayName: string,
  loginUrl: string,
): Promise<void> {
  await sendMail({
    to,
    subject: `Your ${PRODUCT_NAME} account has been reactivated`,
    html: shell({
      headerLabel: 'Account Update',
      title: `Hi ${esc(displayName)}, you're back!`,
      body: p('Your account has been reactivated by an administrator. You can now sign in again.'),
      cta: { label: 'Sign In →', href: loginUrl },
    }),
  });
}

// Admin alert emails

export async function sendJitProvisionedEmail(
  adminEmail: string,
  newUserEmail: string,
  role: string,
  orgName: string,
): Promise<void> {
  await sendMail({
    to: adminEmail,
    subject: `[${esc(orgName)}] New user auto-provisioned via SSO`,
    html: shell({
      headerLabel: 'Admin Alert — JIT Provisioning',
      title: 'New user joined via SSO',
      body:
        p(
          `A new user was automatically provisioned on <strong style="color:#cbd5e1;">${esc(orgName)}</strong> via Single Sign-On.`,
        ) +
        infoTable(
          infoRow('Email', esc(newUserEmail)) +
            infoRow('Role assigned', esc(role)) +
            infoRow('Method', 'JIT (Just-in-Time) Provisioning'),
        ) +
        p(
          'No action required. If this user should not have access, deactivate their account from the Admin Console.',
        ),
    }),
  });
}

export async function sendMailboxConnectedEmail(
  adminEmail: string,
  provider: string,
  count: number,
  orgName: string,
): Promise<void> {
  await sendMail({
    to: adminEmail,
    subject: `[${esc(orgName)}] ${count} mailbox${count !== 1 ? 'es' : ''} connected`,
    html: shell({
      headerLabel: 'Admin Alert — Mailbox Connected',
      title: 'Email provider connected',
      body:
        p(
          `A provider was successfully connected to <strong style="color:#cbd5e1;">${esc(orgName)}</strong>.`,
        ) +
        infoTable(
          infoRow('Provider', provider === 'm365' ? 'Microsoft 365' : 'Google Workspace') +
            infoRow('Mailboxes discovered', String(count)),
        ) +
        p(
          'The platform is now ready to configure sync. Visit the Sync Configuration page to set the date range and start indexing.',
        ),
    }),
  });
}

export async function sendMailboxRemovedEmail(
  adminEmail: string,
  address: string,
  orgName: string,
): Promise<void> {
  await sendMail({
    to: adminEmail,
    subject: `[${esc(orgName)}] Mailbox removed: ${esc(address)}`,
    html: shell({
      headerLabel: 'Admin Alert — Mailbox Removed',
      title: 'Mailbox removed from platform',
      body:
        p(`A mailbox was removed from <strong style="color:#cbd5e1;">${esc(orgName)}</strong>.`) +
        infoTable(infoRow('Mailbox', esc(address))) +
        p(
          'Previously indexed emails from this mailbox remain in the platform. The mailbox will no longer be synced.',
        ),
    }),
  });
}

export async function sendWelcomeEmail(
  orgName: string,
  domains: string,
  adminEmail: string,
): Promise<void> {
  await sendMail({
    to: adminEmail,
    subject: `Welcome to ${PRODUCT_NAME} — ${orgName} is ready`,
    html: welcomeHtml(orgName, domains, adminEmail),
  });
}
