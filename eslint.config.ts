import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'
import obsidianmd from 'eslint-plugin-obsidianmd'
import { defineConfig } from 'eslint/config'

export default defineConfig([
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    // @ts-expect-error - obsidianmd types are incomplete but the config works at runtime
    ...obsidianmd.configs['recommended'],
    eslintConfigPrettier,
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            'scripts/**',
            '.cz-config.cjs',
            'prettier.config.cjs',
            'package.json'
        ]
    },
    {
        files: ['**/*.{js,mjs,cjs,ts}'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.browser,
                // Tests and build tooling run under the Bun runtime
                Bun: 'readonly',
                // Obsidian global functions
                createDiv: 'readonly',
                createEl: 'readonly',
                createSpan: 'readonly',
                createFragment: 'readonly',
                // Obsidian popout-window-aware globals
                activeWindow: 'readonly',
                activeDocument: 'readonly'
            },
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            // The community-plugin reviewer treats both the rule violation
            // and any `eslint-disable @typescript-eslint/no-explicit-any` as
            // an ERROR that blocks the scorecard. Catch locally as error,
            // not warn. See AGENTS.md "Community catalog review".
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
            ],
            '@typescript-eslint/ban-ts-comment': 'off',
            '@typescript-eslint/no-deprecated': 'off',
            // These are too strict for dynamic plugin APIs
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            // Obsidian methods are dynamically added to prototypes
            '@typescript-eslint/no-unsafe-enum-comparison': 'off',
            'no-prototype-builtins': 'off',
            // Allow confirm for delete confirmations
            'no-alert': 'off',
            // Never disable obsidianmd/* rules here: the community catalog
            // reviewer runs its own ruleset against the git archive, so a
            // local disable only hides the finding until submission.
            // Brand names are the supported escape hatch for sentence-case.
            'obsidianmd/ui/sentence-case': [
                'error',
                {
                    brands: [
                        'Knowii',
                        'X',
                        'GitHub Sponsors',
                        'Sébastien Dubois',
                        'dSebastien',
                        // Repo-specific product/protocol names in settings copy
                        'Ollama',
                        'LM Studio',
                        'llama.cpp',
                        'OpenAI',
                        'Obsidian',
                        'Bearer'
                    ],
                    acronyms: ['MCP', 'URN', 'BM25', 'A2A', 'API', 'CORS', 'POST', 'URL'],
                    // Single-token literals (placeholders, URLs, model ids) are
                    // values, not sentences.
                    ignoreRegex: ['^\\S+$']
                }
            ]
        }
    },
    {
        // Tests run in Bun/Node and exercise the local HTTP server over real
        // sockets, so `fetch` is the right tool here (not Obsidian's requestUrl).
        // Tests are not shipped (not scanned by the community scorecard), so the
        // stricter `any` ban is relaxed for terse assertions on dynamic shapes.
        files: ['**/*.spec.ts'],
        rules: {
            'no-restricted-globals': 'off',
            '@typescript-eslint/no-explicit-any': 'off'
        }
    }
])
