import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "release/**", "engine/**", "node_modules/**", "test-results/**", "playwright-report/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/renderer/**/*.tsx"],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: { ...reactHooks.configs.recommended.rules, ...jsxA11y.flatConfigs.recommended.rules },
  },
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }] } },
);
