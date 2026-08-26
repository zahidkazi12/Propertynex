import "server-only";
import type { OtpMessage, OtpProvider } from "./types";

/**
 * Development-only delivery: prints the passcode to the server console.
 *
 * This is a *delivery* stub, not a verification stub — verification is always
 * the real thing, against a keyed HMAC, with real expiry and attempt limits.
 * Selecting this provider only changes where the code is written to.
 *
 * It refuses to exist in production. `NODE_ENV` is checked in the constructor
 * rather than in `send()` so that a production deployment with
 * `OTP_EMAIL_PROVIDER=console` fails at provider resolution — loudly, on the
 * first recovery attempt — instead of quietly printing passcodes into a
 * production log stream. Setting `OTP_DEV_LOG_CODES=false` disables the
 * printing in development too, for anyone who wants to verify the failure path.
 */
export class ConsoleOtpProvider implements OtpProvider {
  readonly name = "console";

  constructor() {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "The console OTP provider cannot be used in production. Configure a real provider (see .env.example)."
      );
    }
  }

  async send(message: OtpMessage): Promise<void> {
    if (process.env.OTP_DEV_LOG_CODES === "false") {
      throw new Error("Console OTP provider is disabled via OTP_DEV_LOG_CODES=false.");
    }

    const channel = message.channel === "EMAIL" ? "email" : "SMS";
    console.log(
      [
        "",
        "  ┌─────────────────────────────────────────────────────────┐",
        "  │  PROPERTYNEX — development OTP delivery                 │",
        "  ├─────────────────────────────────────────────────────────┤",
        `  │  via ${channel} to ${message.destination}`,
        `  │  passcode: ${message.code}   (expires in ${message.expiresInMinutes} min)`,
        "  ├─────────────────────────────────────────────────────────┤",
        "  │  Development only. This provider refuses to run with    │",
        "  │  NODE_ENV=production.                                   │",
        "  └─────────────────────────────────────────────────────────┘",
        "",
      ].join("\n")
    );
  }
}
