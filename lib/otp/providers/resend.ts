import "server-only";
import { OtpDeliveryError, type OtpMessage, type OtpProvider } from "./types";

/**
 * Email delivery via the Resend HTTP API.
 *
 * Implemented against `fetch` rather than an SDK on purpose: it adds no
 * dependency, and the request is a single JSON POST. Any transactional email
 * API with the same shape (SendGrid, Postmark, SES via API Gateway) is a small
 * edit to `endpoint` and the body keys.
 *
 * Credentials come from the environment only — RESEND_API_KEY and
 * OTP_EMAIL_FROM. Nothing is defaulted, so a half-configured provider is
 * rejected at construction rather than failing mid-flow.
 */
export class ResendOtpProvider implements OtpProvider {
  readonly name = "resend";

  private readonly endpoint = "https://api.resend.com/emails";

  constructor(
    private readonly apiKey: string,
    private readonly from: string
  ) {}

  async send(message: OtpMessage): Promise<void> {
    const subject = `${message.code} is your PROPERTYNEX password reset code`;

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.destination],
          subject,
          text: buildPlainText(message),
          html: buildHtml(message),
        }),
        // A hung provider must not hold the request open indefinitely.
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      // Network-level failure. The message deliberately carries no passcode.
      throw new OtpDeliveryError(
        this.name,
        error instanceof Error ? error.message : "network error"
      );
    }

    if (!response.ok) {
      // Read the body for diagnostics but keep it to a bounded length — it is
      // provider text, and it goes to the server log, never to the client.
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new OtpDeliveryError(this.name, `HTTP ${response.status} ${detail}`);
    }
  }
}

function buildPlainText(message: OtpMessage): string {
  return [
    "PROPERTYNEX — password reset",
    "",
    `Your one-time passcode is: ${message.code}`,
    "",
    `This code expires in ${message.expiresInMinutes} minutes and can only be used once.`,
    "If you did not request a password reset, you can ignore this message —",
    "your password has not been changed.",
    "",
    "Never share this code with anyone. PROPERTYNEX staff will never ask for it.",
  ].join("\n");
}

function buildHtml(message: OtpMessage): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px;background:#020617;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
    <table role="presentation" style="max-width:480px;margin:0 auto;background:#0F172A;border-radius:16px;border:1px solid rgba(255,255,255,0.1);">
      <tr><td style="padding:32px;">
        <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#06B6D4;">PROPERTYNEX</p>
        <h1 style="margin:12px 0 0;font-size:20px;color:#ffffff;">Reset your password</h1>
        <p style="margin:12px 0 24px;font-size:14px;line-height:1.6;color:#94A3B8;">
          Enter this one-time passcode to continue. It expires in ${message.expiresInMinutes} minutes and can only be used once.
        </p>
        <p style="margin:0;padding:16px 24px;background:rgba(37,99,235,0.15);border:1px solid rgba(6,182,212,0.35);border-radius:12px;text-align:center;font-size:32px;font-weight:700;letter-spacing:.32em;color:#ffffff;">
          ${message.code}
        </p>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#64748B;">
          If you did not request a password reset, you can ignore this email — your password has not been changed.
          Never share this code with anyone; PROPERTYNEX staff will never ask for it.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}
