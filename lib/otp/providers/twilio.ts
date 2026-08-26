import "server-only";
import { OtpDeliveryError, type OtpMessage, type OtpProvider } from "./types";

/**
 * SMS delivery via the Twilio REST API.
 *
 * Like the email provider this is plain `fetch` — Twilio's Messages endpoint
 * takes HTTP Basic auth and a form-encoded body, both of which the platform
 * already provides, so the SDK would only add weight.
 *
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and OTP_SMS_FROM all come from the
 * environment. The account SID is path-interpolated, so it is validated against
 * Twilio's documented shape before use rather than being pasted into a URL.
 */
export class TwilioOtpProvider implements OtpProvider {
  readonly name = "twilio";

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string
  ) {
    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
      throw new Error("TWILIO_ACCOUNT_SID does not look like a Twilio account SID (expected AC + 32 hex characters).");
    }
  }

  async send(message: OtpMessage): Promise<void> {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    const body = new URLSearchParams({
      To: message.destination,
      From: this.from,
      Body:
        `${message.code} is your PROPERTYNEX password reset code. ` +
        `It expires in ${message.expiresInMinutes} minutes and can only be used once. ` +
        `If you did not request this, ignore this message. Never share this code.`,
    });

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new OtpDeliveryError(
        this.name,
        error instanceof Error ? error.message : "network error"
      );
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new OtpDeliveryError(this.name, `HTTP ${response.status} ${detail}`);
    }
  }
}
