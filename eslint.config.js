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

	// Secure-context APIs may not be reached raw from dashboard code. The dashboard
	// is routinely served over plain http from a tailnet/LAN address, where these
	// properties are simply absent and every raw reach throws. Each banned API has
	// one audited wrapper that works everywhere; new secure-context APIs join this
	// list with a wrapper of their own, never as raw call sites.
	{
		files: ['apps/dashboard/src/**'],
		ignores: [
			'apps/dashboard/src/lib/cockpit/id.ts',              // the sanctioned newId()
			'apps/dashboard/src/lib/cockpit/copy.ts',            // the sanctioned clipboard wrapper
			'apps/dashboard/src/lib/hooks/use-clipboard.svelte.ts',
			'apps/dashboard/src/**/*.test.ts',                   // bun tests: real runtime, APIs exist
		],
		rules: {
			'no-restricted-properties': ['error',
				{ object: 'crypto',    property: 'randomUUID',
					message: 'Secure-context only — absent over plain http off localhost. Use newId() from $lib/cockpit/id.' },
				{ object: 'navigator', property: 'clipboard',
					message: 'Secure-context only. Use copyToClipboard() from $lib/cockpit/copy, or the use-clipboard hook.' },
			],
			// `no-restricted-properties` only matches when the object is a bare
			// Identifier, so it sees `crypto.randomUUID()` and misses
			// `globalThis.crypto.randomUUID()` and `window.navigator.clipboard` —
			// the same absent API reached by a longer path. The property name is
			// the thing that does not exist off a secure origin, so match on that
			// and let the path be whatever it likes.
			'no-restricted-syntax': ['error',
				{
					selector: "MemberExpression[property.name='randomUUID']",
					message: 'Secure-context only — absent over plain http off localhost. Use newId() from $lib/cockpit/id.',
				},
				{
					selector: "MemberExpression[property.name='clipboard']",
					message: 'Secure-context only. Use copyToClipboard() from $lib/cockpit/copy, or the use-clipboard hook.',
				},
			],
		},
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
