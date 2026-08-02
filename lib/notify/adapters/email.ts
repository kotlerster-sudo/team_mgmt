import { Resend } from "resend";
import prisma from "@/lib/prisma";
import { type AdapterResult, type ChannelInput, WIKI_BRAND } from "../types";

const FROM = process.env.RESEND_FROM_EMAIL ?? "Pitstops <no-reply@pitstops.local>";

function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

const esc = (s: string) => s.replace(/</g, "&lt;");

function renderHtml(input: ChannelInput, baseUrl: string): string {
  const brand = input.brand ?? WIKI_BRAND;
  const linkUrl = input.link ? `${baseUrl}${input.link.startsWith("/") ? input.link : `/${input.link}`}` : null;
  const safeBody = esc(input.body ?? "");
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1917;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f5f5f4;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px;background:#ffffff;border:1px solid #e7e5e4;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:24px 24px 8px 24px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#78716c;">${esc(brand.eyebrow)}</div>
          <h1 style="font-size:18px;font-weight:600;margin:8px 0 0 0;color:#1c1917;">${esc(input.title)}</h1>
        </td></tr>
        ${
          safeBody
            ? `<tr><td style="padding:8px 24px 16px 24px;font-size:14px;line-height:1.6;color:#44403c;white-space:pre-wrap;">${safeBody}</td></tr>`
            : ""
        }
        ${
          linkUrl
            ? `<tr><td style="padding:0 24px 24px 24px;">
                <a href="${linkUrl}" style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;">${esc(brand.cta)}</a>
              </td></tr>`
            : ""
        }
        <tr><td style="padding:12px 24px;background:#fafaf9;border-top:1px solid #e7e5e4;font-size:11px;color:#78716c;">
          ${esc(brand.footer)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function renderText(input: ChannelInput, baseUrl: string): string {
  const brand = input.brand ?? WIKI_BRAND;
  const linkUrl = input.link ? `${baseUrl}${input.link.startsWith("/") ? input.link : `/${input.link}`}` : "";
  return [input.title, input.body ?? "", linkUrl ? `Open: ${linkUrl}` : "", "", brand.footer]
    .filter(Boolean)
    .join("\n\n");
}

export async function sendEmail(input: ChannelInput): Promise<AdapterResult> {
  const client = getClient();
  if (!client) {
    return { channel: "email", status: "skipped", error: "RESEND_API_KEY not configured" };
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, emailOptIn: true },
  });
  if (!user?.email) {
    return { channel: "email", status: "skipped", error: "no email on file" };
  }
  if (!user.emailOptIn) {
    return { channel: "email", status: "skipped", error: "user opted out" };
  }

  const baseUrl =
    process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://pitstops.local";

  try {
    await client.emails.send({
      from: input.brand?.from ?? FROM,
      to: user.email,
      subject: input.title,
      html: renderHtml(input, baseUrl),
      text: renderText(input, baseUrl),
    });
    return { channel: "email", status: "sent" };
  } catch (err) {
    return {
      channel: "email",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
