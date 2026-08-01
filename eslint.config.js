import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";
import prettier from "eslint-config-prettier";

/**
 * Flat ESLint config for the Disburse monorepo.
 *
 * Philosophy: gate CI on correctness, not style. Bug-class rules
 * (rules-of-hooks, unsafe patterns) are errors; iterative/stylistic ones
 * (exhaustive-deps, explicit-any, unused vars) are warnings so the build
 * stays green while still surfacing debt. Prettier owns formatting, so its
 * config is applied last to switch off conflicting stylistic rules.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "node_modules/**",
      "coverage/**",
      "deployments/**",
      "**/*.tsbuildinfo",
      ".vercel/**"
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Browser application code.
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser }
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: [
            "buildFetchCommand",
            "createDynamicEthereumProvider",
            "DYNAMIC_ENVIRONMENT_ID",
            "dynamicBridgeNetworks",
            "dynamicPaymentNetworks",
            "useDisburseDynamicWallet",
            "useI18n",
            "useInboxUnread"
          ]
        }
      ]
    }
  },

  // Node-side code: server, serverless API, scripts, and root config files.
  {
    files: [
      "server/**/*.ts",
      "api/**/*.ts",
      "api-handlers/**/*.ts",
      "scripts/**/*.{ts,mjs,js}",
      "packages/**/*.ts",
      "tests/**/*.ts"
    ],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // Plain JS/MJS/CJS anywhere (CLIs, deploy scripts, config) run on Node.
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // Pragmatic rule tuning shared across the repo.
  {
    plugins: { "unused-imports": unusedImports },
    rules: {
      // Unused imports are auto-removable (run `npm run lint:fix`) and gate CI;
      // unused locals/args stay warnings so genuinely staged code isn't blocked.
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "none"
        }
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },

  // Disable stylistic rules that Prettier owns. Keep last.
  prettier
);
