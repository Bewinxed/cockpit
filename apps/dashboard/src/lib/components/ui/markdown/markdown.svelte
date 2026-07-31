<script lang="ts">
	import { Streamdown, theme as streamdownTheme, type Theme } from 'svelte-streamdown';
	import { PROSE } from '$lib/prose';

	let {
		source,
		invert = false,
		streaming = false,
	}: { source: string; invert?: boolean; streaming?: boolean } = $props();

	// Streamdown's stock themes hardcode a Tailwind palette (bg-gray-100,
	// text-blue-600, marker:hidden) that would out-shout PROSE. Blank every
	// group PROSE already owns and keep only what has no prose equivalent:
	// `code.line` makes each rendered line a block (the lines carry no newline
	// of their own), and the table wrapper needs its own scroll container.
	// Groups left at their defaults — alerts, mermaid, footnotes, citations,
	// popovers — are streamdown chrome that prose says nothing about.
	const PLAIN: Theme = {
		...streamdownTheme,
		link: { base: '', blocked: '' },
		h1: { base: '' },
		h2: { base: '' },
		h3: { base: '' },
		h4: { base: '' },
		h5: { base: '' },
		h6: { base: '' },
		paragraph: { base: '' },
		ul: { base: '' },
		ol: { base: '' },
		li: { base: '', checkbox: 'mr-2' },
		code: { ...streamdownTheme.code, base: '', container: '', header: 'hidden', pre: '' },
		codespan: { base: '' },
		image: { base: '', image: '' },
		blockquote: { base: '' },
		table: { base: 'overflow-x-auto max-w-full', table: '' },
		thead: { base: '' },
		tbody: { base: '' },
		tfoot: { base: '' },
		tr: { base: '' },
		td: { base: '' },
		th: { base: '' },
		sup: { base: '' },
		sub: { base: '' },
		hr: { base: '' },
		strong: { base: '' },
		em: { base: '' },
		del: { base: '' },
		math: { block: '', inline: '' },
		descriptionList: { base: '' },
		descriptionTerm: { base: '' },
		descriptionDetail: { base: '' }
	};
</script>

<Streamdown
	content={source}
	class="{PROSE} {invert ? 'prose-invert' : ''}"
	theme={PLAIN}
	mergeTheme={false}
	controls={{ code: false, mermaid: false, table: false }}
	static={!streaming}
/>
