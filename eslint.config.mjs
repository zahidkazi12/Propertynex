import next from "eslint-config-next/core-web-vitals";

/**
 * ESLint flat config.
 *
 * Next.js 16 removed the `next lint` command and `eslint-config-next` now ships
 * a flat config array, which ESLint 9's eslintrc loader cannot consume — the
 * previous `.eslintrc.json` ("extends": "next/core-web-vitals") crashed on load
 * rather than reporting lint errors. This replaces it; `npm run lint` calls
 * `eslint` directly.
 */
const config = [
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "next-env.d.ts",
      // Compiled test output — the sources under tests/ are linted instead.
      "tests/.build/**",
    ],
  },
  ...next,
  {
    rules: {
      /**
       * `eslint-config-next` does not extend `eslint:recommended`, so this rule was
       * off — which made the five `eslint-disable-next-line no-control-regex`
       * comments in this repo report "unused directive" warnings. They are not
       * stale: every one sits on a deliberate `[\x00-\x1F\x7F-\x9F]` strip in a
       * sanitiser (`lib/validation/{property,inquiry,media}.ts`, and the two
       * upload display-name helpers). Enabling the rule is what makes those
       * comments mean something again, and it catches a control character that
       * arrives in a regex by accident — a literal escape pasted into a pattern —
       * rather than on purpose.
       */
      "no-control-regex": "error",
    },
  },
];

export default config;
