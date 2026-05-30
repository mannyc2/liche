import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import zod from 'eslint-plugin-zod'
import importX from 'eslint-plugin-import-x'
import noOnlyTests from 'eslint-plugin-no-only-tests'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'

export default tseslint.config(
  // Build output, the Stryker mutation sandbox (transpiled/mutated copies), and generated CLIs
  // (which must match the generator byte-for-byte).
  { ignores: ['**/dist/**', '**/.stryker-tmp/**', '**/*.generated.ts'] },

  js.configs.recommended,

  // Type-aware linting (recommendedTypeChecked, NOT strict): adds the rules that catch real bugs in
  // async CLI code — no-floating-promises, no-misused-promises, await-thenable, no-unnecessary-condition.
  tseslint.configs.recommendedTypeChecked,

  // This codebase is zod-heavy (v4); lint zod usage for best practices.
  zod.configs.recommended,

  // Point typescript-eslint at the nearest tsconfig per file. Each package has its own tsconfig and
  // includes both src and test, so projectService resolves type info for everything under packages/*.
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Import hygiene for a published monorepo. The TypeScript resolver maps the codebase's
  // `.js`-extension specifiers (moduleResolution: Bundler) to their real `.ts` sources.
  {
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: [
            'packages/*/tsconfig.json',
            'packages/extensions/*/tsconfig.json',
            'packages/extensions/agents/*/tsconfig.json',
          ],
        }),
      ],
    },
    rules: {
      // Don't import a package that the importing package's package.json doesn't declare — a published
      // package must list every runtime dep it pulls in, or it breaks when installed standalone.
      'import-x/no-extraneous-dependencies': 'error',
      // No circular imports between modules.
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],
    },
  },

  // Catch a committed `.only` (test.only / describe.only) that would silently skip the rest of a file.
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    plugins: { 'no-only-tests': noOnlyTests },
    rules: { 'no-only-tests/no-only-tests': 'error' },
  },

  // Keep formatting to Prettier — turn off every ESLint rule that would fight it.
  prettier,

  {
    rules: {
      // The framework deliberately uses `any` (Schema<any>, erased/generated types) and non-null
      // assertions on argv indexing (`argv[i]!`); leave these off so lint stays signal, not noise.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',

      // Because `any` is intentional, the type-checked `no-unsafe-*` family fires constantly and is
      // pure noise here. Drop it but KEEP the high-value promise/condition rules from typeChecked.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',

      // Two type-checked rules that produced ZERO real signal here (verified by a per-rule triage of
      // every finding) and would only ever recur, so disabling beats peppering source with suppressions:
      //  • await-thenable — every hit (src included) is bun-types mistyping `await expect(...).resolves`
      //                     as `void`, or a union-typed sink call; the await is correct and matches Bun's
      //                     documented pattern. Revisit if bun-types fixes the matcher typing.
      //  • require-await  — 85 hits, all functions made async to satisfy a Promise-returning
      //                     interface/mock/generator with no forgotten await; near-zero bug-catching value
      //                     (a real forgotten await also trips no-floating-promises or a type error).
      // (unbound-method stays ON for src — it catches real this-binding bugs — and is scoped off tests below.)
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/require-await': 'off',

      // Allow the companion-type pattern (`export declare namespace BaseError { type Options = … }`)
      // so call sites read `BaseError.Options`. Still bans runtime namespaces (those carry real code).
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // eslint-plugin-zod 'recommended' is opinionated about style. Keep the genuinely useful checks
      // (consistent imports, zod-v4 number/object modernizations) and relax the purely stylistic
      // ones — flip any back to 'error' if you want to adopt the convention.
      'zod/prefer-string-schema-with-trim': 'off', // forcing .trim() on every string is too aggressive
      'zod/consistent-schema-var-name': 'off', // would require renaming every schema variable
      'zod/prefer-strict-object': 'off', // z.object vs z.strictObject is a behavior choice, not a lint
    },
  },

  // These rules are valuable in src but fire only on intentional patterns in tests, so keep them
  // guarding src and silence the test noise:
  //  • no-base-to-string — caught a real "[object Object]" bug in auth identity handling; in tests only
  //                        benign String() coercions of fixtures.
  //  • restrict-template-expressions — in tests only the SecretString redaction assertions (the
  //                        coercion IS what's under test).
  //  • unbound-method — catches real this-binding bugs; the only test hits destructure this-less
  //                     ctx.ok/ctx.error helpers.
  {
    files: ['**/*.test.ts', '**/test/**/*.ts', '**/fixtures/**/*.ts'],
    rules: {
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Root scripts, examples, and flat-config/JS files live outside any tsconfig, so type-aware rules
  // can't run there (they'd error "not found in project"). Disable type-checking for those globs.
  {
    files: ['scripts/**', 'examples/**', '**/*.mjs', '**/*.cjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
