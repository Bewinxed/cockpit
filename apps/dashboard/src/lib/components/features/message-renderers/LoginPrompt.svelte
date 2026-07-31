<script lang="ts">
	import { IconKey, IconExternal, IconArrowRight, IconAlert, IconSpinner, IconError } from '$lib/icons';
	import type { MessageRendererProps } from './types';

	let {
		message,
		isActive = false,
		onLoginSubmit,
		onLoginCancel,
		onDismissMessage
	}: MessageRendererProps = $props();

	// Login prompt state
	let loginCode = $state('');
	let loginLoading = $state(false);
	let loginError = $state<string | null>(null);

	const errorId = $props.id();

	async function handleLoginSubmit() {
		if (!loginCode.trim() || !onLoginSubmit) return;
		loginLoading = true;
		loginError = null;
		try {
			await onLoginSubmit(loginCode.trim());
		} catch (err) {
			loginError = err instanceof Error ? err.message : 'Login failed';
		} finally {
			loginLoading = false;
		}
	}

	function handleCodeKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleLoginSubmit();
		} else if (e.key === 'Escape') {
			onLoginCancel?.();
		}
	}
</script>

<div class="flex justify-start gap-3 group">
	<div
		class="flex flex-col gap-1 items-start w-full"
	>
		{#if isActive}
			<!-- Active: Show full login form -->
			<div class="w-full max-w-md">
				<div class="border border-dotted border-border rounded-lg p-5 bg-card space-y-4">
					<!-- Header -->
					<div class="flex items-start gap-3">
						<div
							class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"
						>
							<IconKey class="w-5 h-5 text-primary" />
						</div>
						<div>
							<h3 class="font-sans font-semibold text-foreground text-lg leading-tight">
								Log in to Claude
							</h3>
							<p class="text-sm text-muted-foreground mt-0.5">
								Authenticate with your Claude MAX subscription
							</p>
						</div>
					</div>

					<!-- Step 1: Open auth page -->
					{#if message.metadata?.authUrl}
						<div class="space-y-2">
							<div
								class="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide"
							>
								<span
									class="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium"
									>1</span
								>
								<span>Open login page</span>
							</div>
							<a
								href={message.metadata.authUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium group w-fit"
							>
								<span>Open Anthropic login</span>
								<IconExternal
									class="w-4 h-4 opacity-70 group-hover:opacity-100 transition-opacity"
								/>
							</a>
						</div>
					{/if}

					<!-- Step 2: Paste code -->
					<div class="space-y-2">
						<div
							class="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide"
						>
							<span
								class="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium"
								>2</span
							>
							<span>Paste the code</span>
						</div>
						<div class="relative">
							<input
								type="text"
								bind:value={loginCode}
								placeholder="Paste code here..."
								aria-label="Authorization code"
								aria-invalid={loginError ? 'true' : undefined}
								aria-describedby={loginError ? errorId : undefined}
								disabled={loginLoading}
								onkeydown={handleCodeKeydown}
								class="w-full px-4 py-2.5 bg-background border border-border rounded-md text-base sm:text-sm font-mono
                       placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
							/>
						</div>
						<p class="text-xs text-muted-foreground">
							After authorizing, you'll see a code like <code
								class="px-1 py-0.5 bg-muted rounded text-[11px]">abc123#xyz789</code
							>
						</p>
					</div>

					<!-- Error -->
					{#if loginError}
						<div
							id={errorId}
							role="alert"
							class="flex items-center gap-2 text-sm text-error bg-error/10 rounded-md px-3 py-2"
						>
							<IconAlert class="w-4 h-4 shrink-0" />
							<span>{loginError}</span>
						</div>
					{/if}

					<!-- Actions -->
					<div class="flex items-center gap-3 pt-1">
						<button
							onclick={handleLoginSubmit}
							disabled={!loginCode.trim() || loginLoading}
							class="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium
                     hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-[background-color,opacity] duration-150 ease-out group"
						>
							{#if loginLoading}
								<IconSpinner class="w-4 h-4 animate-spin" />
								<span>Logging in...</span>
							{:else}
								<span>Complete login</span>
								<IconArrowRight
									class="w-4 h-4 opacity-70 group-hover:translate-x-0.5 transition-transform"
								/>
							{/if}
						</button>
						<button
							onclick={onLoginCancel}
							disabled={loginLoading}
							class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:underline underline-offset-2 transition-colors"
						>
							Cancel
						</button>
					</div>
				</div>
			</div>
		{:else}
			<!-- Inactive: Show compact dismissible version -->
			<div
				class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent/50 border border-dotted border-border rounded-lg text-sm group"
			>
				<IconKey class="w-3.5 h-3.5 text-muted-foreground" />
				<span class="text-muted-foreground">Login attempted</span>
				<span class="text-muted-foreground font-mono text-xs">•••••••#•••</span>
				{#if onDismissMessage}
					<button
						onclick={onDismissMessage}
						class="ml-1 p-0.5 rounded hover:bg-accent transition-colors opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
						title="Dismiss"
						aria-label="Dismiss"
					>
						<IconError class="w-3.5 h-3.5 text-muted-foreground hover:text-muted-foreground" />
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
