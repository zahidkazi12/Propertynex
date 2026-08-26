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
];

export default config;
