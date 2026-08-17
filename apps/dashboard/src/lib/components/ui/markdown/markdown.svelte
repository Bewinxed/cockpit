<script lang="ts">
	import { Streamdown, theme as streamdownTheme, type Theme } from 'svelte-streamdown';
	import { PROSE } from '$lib/prose';
	import OutputBlock from '$lib/components/features/tool-cards/OutputBlock.svelte';

	let {
		source,
		invert = false,
		streaming = false,
	}: { source: string; invert?: boolean; streaming?: boolean } = $props();

	// Streamdown's stock themes hardcode a Tailwind palette (bg-gray-100,
	// text-blue-600, marker:hidden) that would out-shout PROSE. Blank every
	// group PROSE already owns and keep only what has no prose equivalent: the
	// table wrapper needs its own scroll container. Groups left at their
	// defaults — alerts, footnotes, citations, popovers — are streamdown chrome
	// that prose says nothing about, and the `code` group is not here because a
	// fence never reaches streamdown's renderer (see the snippet below).
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
	controls={{ mermaid: false, table: false }}
	static={!streaming}
>
	<!-- A fence is code, and the console has one surface for code: the same well a
	     tool result opens into, painted by the same highlighter. Streamdown can
	     highlight fences itself, but it resolves one shiki theme at a time and
	     writes it as inline colours — registering a custom pair through its
	     `shikiThemes` pins every fence to whichever theme is listed first, and
	     following the appearance instead means re-tokenizing every block on every
	     switch, through a second shiki with a second cache. Ours carries both inks
	     on the token and lets CSS choose. Prose dresses every `pre` and `code` it
	     contains, so the well opts out of that dressing here; inline code
	     (`codespan`) keeps it, because it is prose, not a listing. -->
	{#snippet code({ token })}
		<div
			class="not-prose my-3 [&_code]:bg-transparent! [&_code]:p-0! [&_pre]:border-0! [&_pre]:bg-transparent!"
		>
			<OutputBlock text={token.text} language={token.lang} />
		</div>
	{/snippet}
</Streamdown>
