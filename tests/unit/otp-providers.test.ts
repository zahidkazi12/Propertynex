// Must come first: installs the `server-only` resolution patch before any
// provider module is loaded. See tests/stubs/patch-server-only.ts.
import "../stubs/patch-server-only";

import test from "node:test";
import assert from "node:assert/strict";
import { OtpProviderNotConfiguredError } from "../../lib/otp/providers/types";

/**
 * Guards on provider resolution.
 *
 * The claim being tested is the one that matters most for correctness of the
 * whole flow: **there is no fake passcode path in production.** The development
 * console provider must be unreachable when NODE_ENV=production, and a channel
 * with no provider configured must fail loudly rather than silently pretending a
 * passcode was delivered.
 *
 * `getOtpProvider` memoises per process, so each case re-imports the module tree
 * with a cleared require cache. The `server-only` import is mapped to an empty
 * stub (see tests/stubs/server-only.ts), which is exactly what Next resolves it
 * to on the server.
 */

declare const require: {
  (id: string): unknown;
  resolve(id: string): string;
  cache: Record<string, unknown>;
};

type ProvidersModule = typeof import("../../lib/otp/providers/index");

/**
 * Re-imports the provider tree so module-level memoisation starts empty.
 *
 * `providers/types` is deliberately left cached. It exports the error classes,
 * and reloading it would mint a second `OtpProviderNotConfiguredError` — a
 * distinct constructor from the one this file imported — making every
 * `instanceof` check silently fail even though the right error was thrown.
 * Only the modules that hold state or construct providers need clearing.
 */
function freshProviders(): ProvidersModule {
  for (const key of Object.keys(require.cache)) {
    const isProviderModule =
      key.includes("otp") && key.includes("providers") && !key.includes("types");
    if (isProviderModule) delete require.cache[key];
  }
  return require(require.resolve("../../lib/otp/providers/index")) as ProvidersModule;
}

const SAVED_ENV = { ...process.env };

function withEnv(overrides: Record<string, string | undefined>, run: (mod: ProvidersModule) => void) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run(freshProviders());
  } finally {
    for (const key of Object.keys(overrides)) {
      if (SAVED_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = SAVED_ENV[key];
    }
  }
}

test("production with no email provider configured refuses to resolve one", () => {
  withEnv({ NODE_ENV: "production", OTP_EMAIL_PROVIDER: undefined }, (mod) => {
    assert.throws(
      () => mod.getOtpProvider("EMAIL"),
      OtpProviderNotConfiguredError,
      "production silently accepted a missing email provider"
    );
  });
});

test("production with no SMS provider configured refuses to resolve one", () => {
  withEnv({ NODE_ENV: "production", OTP_SMS_PROVIDER: undefined }, (mod) => {
    assert.throws(() => mod.getOtpProvider("SMS"), OtpProviderNotConfiguredError);
  });
});

test("the console provider cannot be selected in production", () => {
  // The central guarantee: no fake delivery path exists in a production build,
  // even if someone explicitly asks for one.
  //
  // Both the TYPE and the message are asserted. The type is what the routes
  // branch on to return a generic 503 "temporarily unavailable"; an earlier
  // version of this test checked only the message, and the provider threw a
  // plain Error, so production answered with a bare 500 and no diagnostic.
  // Checking the message alone would let that regress again.
  withEnv({ NODE_ENV: "production", OTP_EMAIL_PROVIDER: "console" }, (mod) => {
    assert.throws(
      () => mod.getOtpProvider("EMAIL"),
      (error: unknown) =>
        error instanceof OtpProviderNotConfiguredError &&
        /cannot be used in production/.test((error as Error).message),
      "console provider was constructible in production, or threw the wrong error type"
    );
  });

  withEnv({ NODE_ENV: "production", OTP_SMS_PROVIDER: "console" }, (mod) => {
    assert.throws(
      () => mod.getOtpProvider("SMS"),
      (error: unknown) =>
        error instanceof OtpProviderNotConfiguredError &&
        /cannot be used in production/.test((error as Error).message)
    );
  });
});

test("every provider construction fault surfaces as OtpProviderNotConfiguredError", () => {
  // The routes only translate this one error type into the generic
  // "temporarily unavailable" response. Anything else becomes an opaque 500, so
  // each way a provider can refuse to be built is pinned to the same type here.
  const cases: Array<[string, Record<string, string | undefined>, "EMAIL" | "SMS"]> = [
    ["console in production", { NODE_ENV: "production", OTP_EMAIL_PROVIDER: "console" }, "EMAIL"],
    ["unset in production", { NODE_ENV: "production", OTP_EMAIL_PROVIDER: undefined }, "EMAIL"],
    ["unknown provider name", { NODE_ENV: "production", OTP_EMAIL_PROVIDER: "sendmail" }, "EMAIL"],
    [
      "missing credential",
      {
        NODE_ENV: "production",
        OTP_EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: undefined,
        OTP_EMAIL_FROM: undefined,
      },
      "EMAIL",
    ],
    [
      "malformed Twilio SID",
      {
        NODE_ENV: "production",
        OTP_SMS_PROVIDER: "twilio",
        TWILIO_ACCOUNT_SID: "not-a-sid",
        TWILIO_AUTH_TOKEN: "token",
        OTP_SMS_FROM: "+15550000000",
      },
      "SMS",
    ],
  ];

  for (const [label, env, channel] of cases) {
    withEnv(env, (mod) => {
      assert.throws(
        () => mod.getOtpProvider(channel),
        OtpProviderNotConfiguredError,
        `"${label}" did not surface as OtpProviderNotConfiguredError`
      );
    });
  }
});

test("development defaults to the console provider so the flow works out of the box", () => {
  withEnv({ NODE_ENV: "development", OTP_EMAIL_PROVIDER: undefined }, (mod) => {
    assert.equal(mod.getOtpProvider("EMAIL").name, "console");
  });
  withEnv({ NODE_ENV: "development", OTP_SMS_PROVIDER: undefined }, (mod) => {
    assert.equal(mod.getOtpProvider("SMS").name, "console");
  });
});

test("a real provider missing its credentials is rejected, not partially configured", () => {
  withEnv(
    {
      NODE_ENV: "production",
      OTP_EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: undefined,
      OTP_EMAIL_FROM: undefined,
    },
    (mod) => {
      assert.throws(() => mod.getOtpProvider("EMAIL"), OtpProviderNotConfiguredError);
    }
  );

  withEnv(
    {
      NODE_ENV: "production",
      OTP_EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_key",
      OTP_EMAIL_FROM: undefined,
    },
    (mod) => {
      assert.throws(
        () => mod.getOtpProvider("EMAIL"),
        OtpProviderNotConfiguredError,
        "accepted a provider with an API key but no from-address"
      );
    }
  );
});

test("a blank credential counts as missing", () => {
  withEnv(
    {
      NODE_ENV: "production",
      OTP_EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "   ",
      OTP_EMAIL_FROM: "PROPERTYNEX <no-reply@example.com>",
    },
    (mod) => {
      assert.throws(() => mod.getOtpProvider("EMAIL"), OtpProviderNotConfiguredError);
    }
  );
});

test("a fully configured real provider resolves", () => {
  withEnv(
    {
      NODE_ENV: "production",
      OTP_EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_key",
      OTP_EMAIL_FROM: "PROPERTYNEX <no-reply@example.com>",
    },
    (mod) => {
      assert.equal(mod.getOtpProvider("EMAIL").name, "resend");
    }
  );

  withEnv(
    {
      NODE_ENV: "production",
      OTP_SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`,
      TWILIO_AUTH_TOKEN: "token",
      OTP_SMS_FROM: "+15550000000",
    },
    (mod) => {
      assert.equal(mod.getOtpProvider("SMS").name, "twilio");
    }
  );
});

test("a malformed Twilio account SID is rejected before it reaches a URL", () => {
  withEnv(
    {
      NODE_ENV: "production",
      OTP_SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "../../evil",
      TWILIO_AUTH_TOKEN: "token",
      OTP_SMS_FROM: "+15550000000",
    },
    (mod) => {
      assert.throws(
        () => mod.getOtpProvider("SMS"),
        (error: unknown) =>
          error instanceof OtpProviderNotConfiguredError &&
          /does not look like a Twilio account SID/.test((error as Error).message)
      );
    }
  );
});

test("an unknown provider name is rejected rather than falling back", () => {
  withEnv({ NODE_ENV: "production", OTP_EMAIL_PROVIDER: "sendmail" }, (mod) => {
    assert.throws(() => mod.getOtpProvider("EMAIL"), /unknown provider/);
  });
});
