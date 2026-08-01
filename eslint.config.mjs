// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
    // Generated / build output / dev-only utilities + root JS config files (not in the TS project).
    {
        ignores: [
            'dist/**',
            'coverage/**',
            'src/migrations/**',
            'src/scripts/**',
            'eslint.config.mjs',
            'jest.config.js',
        ],
    },

    js.configs.recommended,
    // Type-aware rules (no-floating-promises, no-misused-promises, …) — the payoff in this
    // transaction-heavy, async codebase.
    ...tseslint.configs.recommendedTypeChecked,

    {
        languageOptions: {
            parserOptions: {
                project: './tsconfig.eslint.json',
                tsconfigRootDir: import.meta.dirname,
            },
            globals: { ...globals.node },
        },
        rules: {
            // Allow deliberately-unused args/vars/caught-errors when prefixed with `_`
            // (e.g. Express error middleware's required 4th `next` param).
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
            ],
        },
    },

    // Tests legitimately use `any` mocks and non-null assertions — linting those is just noise.
    {
        files: ['tests/**/*.ts'],
        languageOptions: { globals: { ...globals.node, ...globals.jest } },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/unbound-method': 'off',
        },
    },

    // Must be last: turns off ESLint rules that conflict with Prettier (Prettier owns formatting).
    prettier,
);
