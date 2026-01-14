import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default tseslint.config(
	// Base JS recommended rules
	js.configs.recommended,

	// TypeScript recommended rules
	...tseslint.configs.recommended,

	// Svelte recommended rules
	...svelte.configs['flat/recommended'],

	// Global settings
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},

	// TypeScript files
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: true
			}
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			'@typescript-eslint/no-explicit-any': 'warn'
		}
	},

	// Svelte files
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parser: svelte.parser,
			parserOptions: {
				parser: tseslint.parser,
				extraFileExtensions: ['.svelte'],
				projectService: true
			}
		},
		rules: {
			// Svelte 5 runes are fine
			'svelte/valid-compile': 'warn',
			'svelte/no-unused-svelte-ignore': 'warn',
			// Disable navigation/resolve rule - resolve() doesn't support query strings yet
			// See: https://github.com/sveltejs/kit/issues/14750
			'svelte/no-navigation-without-resolve': 'off',
			// Allow built-in Map/Set/URL classes in utility functions (non-reactive contexts)
			'svelte/prefer-svelte-reactivity': 'off'
		}
	},

	// Ignore patterns
	{
		ignores: [
			'**/node_modules/**',
			'**/.svelte-kit/**',
			'**/dist/**',
			'**/build/**',
			'**/.git/**',
			'**/coverage/**',
			'**/*.config.js',
			'**/*.config.ts',
			'**/drizzle/**'
		]
	}
);
