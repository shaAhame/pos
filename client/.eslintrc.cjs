module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
  settings: { react: { version: "18" } },
  plugins: ["react", "react-hooks"],
  extends: ["eslint:recommended", "plugin:react/recommended", "plugin:react/jsx-runtime", "plugin:react-hooks/recommended"],
  rules: {
    "react/prop-types": "off",
    "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],
    "no-unused-vars": ["warn", { args: "none" }],
    "react/no-unescaped-entities": "off",
  },
  overrides: [{ files: ["src/__tests__/**"], env: { node: true } }],
};
