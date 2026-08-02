import { Resend } from "resend";

/**
 * First contact with an external grantee organisation. Shares the reset-token
 * machinery — the account exists but has no usable password until they set one
 * — with a longer window, because an NGO's finance contact will not read their
 * inbox inside an hour.
 */
export async function sendPartnerInviteEmail(
  email: string,
  token: string,
  opts: { orgName: string; invitedBy?: string | null; expiresInDays: number },
) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const url = `${process.env.NEXTAUTH_URL}/reset-password?token=${token}&invite=1`;
  const from = opts.invitedBy ? ` by ${escapeHtml(opts.invitedBy)}` : "";

  await resend.emails.send({
    from: "noreply@pitstop.app",
    to: email,
    subject: `You've been invited to file grant reports for ${opts.orgName}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Your grant reporting account</title></head>
<body style="margin:0;padding:0;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafaf9;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #e7e5e4;box-shadow:0 1px 3px rgba(0,0,0,0.06);padding:40px 32px;" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="width:40px;height:40px;background:#0ea5e9;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;">
            <span style="color:#ffffff;font-size:20px;line-height:40px;font-weight:700;">⊙</span>
          </div>
          <h1 style="margin:12px 0 0;font-size:18px;font-weight:600;color:#1c1917;">Grant reporting</h1>
        </td></tr>
        <tr><td>
          <h2 style="margin:0 0 8px;font-size:16px;font-weight:600;color:#1c1917;">An account has been created for ${escapeHtml(opts.orgName)}</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#78716c;line-height:1.5;">
            You've been invited${from} to file periodic reports on ${escapeHtml(opts.orgName)}'s grants. Choose a password to get started — you'll then see the budgets your organisation is reporting on.
          </p>
          <a href="${url}" style="display:block;text-align:center;background:#0ea5e9;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;padding:10px 24px;border-radius:8px;margin-bottom:24px;">
            Set your password
          </a>
          <p style="margin:0 0 8px;font-size:12px;color:#a8a29e;line-height:1.5;">
            This link expires in ${opts.expiresInDays} days. If you weren't expecting this, you can ignore this email.
          </p>
          <p style="margin:0;font-size:12px;color:#a8a29e;word-break:break-all;">
            Or copy this URL: <a href="${url}" style="color:#0ea5e9;">${url}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
    `.trim(),
  });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function sendPasswordResetEmail(email: string, token: string) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${token}`;

  await resend.emails.send({
    from: "noreply@pitstop.app",
    to: email,
    subject: "Reset your Pitstop password",
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafaf9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #e7e5e4;box-shadow:0 1px 3px rgba(0,0,0,0.06);padding:40px 32px;" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <div style="width:40px;height:40px;background:#0ea5e9;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;">
                <span style="color:#ffffff;font-size:20px;line-height:40px;font-weight:700;">⊙</span>
              </div>
              <h1 style="margin:12px 0 0;font-size:18px;font-weight:600;color:#1c1917;">Pitstop</h1>
            </td>
          </tr>
          <tr>
            <td>
              <h2 style="margin:0 0 8px;font-size:16px;font-weight:600;color:#1c1917;">Reset your password</h2>
              <p style="margin:0 0 24px;font-size:14px;color:#78716c;line-height:1.5;">
                We received a request to reset the password for your Pitstop account. Click the button below to choose a new password.
              </p>
              <a href="${resetUrl}" style="display:block;text-align:center;background:#0ea5e9;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;padding:10px 24px;border-radius:8px;margin-bottom:24px;">
                Reset Password
              </a>
              <p style="margin:0 0 8px;font-size:12px;color:#a8a29e;line-height:1.5;">
                This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
              </p>
              <p style="margin:0;font-size:12px;color:#a8a29e;word-break:break-all;">
                Or copy this URL: <a href="${resetUrl}" style="color:#0ea5e9;">${resetUrl}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim(),
  });
}
