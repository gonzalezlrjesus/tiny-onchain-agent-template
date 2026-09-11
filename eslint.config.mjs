import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { importX } from "eslint-plugin-import-x";
import sonarjs from "eslint-plugin-sonarjs";

export default tseslint.config(
  {
    ignores: ["node_modules/", "dist/", "coverage/", ".stryker-tmp/", "reports/"],
  },
  {
    settings: {
      "import-x/resolver": { typescript: { project: "./tsconfig.json" } },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "import-x": importX,
      sonarjs,
    },
    rules: {
      complexity: ["error", 8],
      "max-lines-per-function": ["error", { max: 80, skipComments: true, skipBlankLines: true }],
      "max-lines": ["error", { max: 300, skipComments: true }],
      "max-params": ["error", { max: 4 }],
      "max-depth": ["error", { max: 3 }],
      "max-nested-callbacks": ["error", { max: 3 }],
      "sonarjs/cognitive-complexity": ["error", 15],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/return-await": ["error", "in-try-catch"],
      "no-useless-catch": "error",
      "import-x/first": "error",
      "import-x/order": "error",
      "import-x/no-cycle": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-self-import": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "id-length": ["error", { min: 2, exceptions: ["i", "j", "k"], properties: "never" }],
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "variable",
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
        },
        { selector: "function", format: ["camelCase", "PascalCase"] },
        { selector: "parameter", format: ["camelCase"] },
        { selector: "memberLike", format: ["camelCase"] },
        {
          selector: "typeProperty",
          format: ["camelCase", "snake_case", "PascalCase"],
        },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "enumMember", format: ["PascalCase", "UPPER_CASE"] },
      ],
      "@typescript-eslint/no-shadow": "error",
      "no-param-reassign": [
        "error",
        {
          props: true,
          ignorePropertyModificationsFor: ["rec", "row", "draft", "acc"],
        },
      ],
      "@typescript-eslint/no-magic-numbers": [
        "error",
        {
          ignoreArrayIndexes: true,
          enforceConst: true,
          detectObjects: true,
          // Numeric enum initializers are the documented code tables here.
          ignoreEnums: true,
          ignore: [0, 1],
        },
      ],
      "sonarjs/no-duplicate-string": ["error", { threshold: 4 }],
      "sonarjs/no-identical-functions": "error",
      "sonarjs/no-duplicated-branches": "error",
      "sonarjs/no-identical-expressions": "error",
      "sonarjs/prefer-immediate-return": "error",
      "sonarjs/no-collapsible-if": "error",
      "sonarjs/prefer-single-boolean-return": "error",
      "sonarjs/no-redundant-boolean": "error",
      "sonarjs/no-unused-collection": "error",
      "sonarjs/no-nested-conditional": "error",
      "sonarjs/no-small-switch": "error",
      "sonarjs/max-union-size": ["error", { threshold: 6 }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-else-return": "error",
      "prefer-template": "error",
      "object-shorthand": ["error", "always"],
      "no-empty": ["error", { allowEmptyCatch: false }],
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // Explicit conversions for nullable/unknown/bigint; numbers read fine
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      // Specs optimize for readability, not density limits.
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
      complexity: "off",
      "max-depth": "off",
      "@typescript-eslint/no-magic-numbers": "off",
      "id-length": "off",
      "@typescript-eslint/naming-convention": "off",
      "no-param-reassign": "off",
      "sonarjs/cognitive-complexity": "off",
      "sonarjs/no-duplicate-string": "off",
    },
  },
);
