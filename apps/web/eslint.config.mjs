import next from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const config = [
  ...next,
  ...nextTypescript,
  { files: ["**/*.tsx"], rules: jsxA11y.flatConfigs.recommended.rules },
  { ignores: [".next/**", "next-env.d.ts", "tests/logic.test.ts", "playwright-report/**", "test-results/**"] },
];

export default config;
