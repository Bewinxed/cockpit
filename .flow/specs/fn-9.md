# Run LSP/Linting Diagnostics on Codebase

## Overview

Collect code quality diagnostics from available linting tools on the Cockpit SvelteKit + Svelte 5 monorepo. This is a **diagnostic/analysis task** - no code fixes, just collecting and presenting tool output.

## Scope

**In scope:**
- Run `sv check` (Svelte + TypeScript diagnostics) on `apps/dashboard/`
- Run `tsc --noEmit` on pure TypeScript packages
- Collect and organize diagnostic output
- Document existing issues and their severity

**Out of scope:**
- Fixing discovered issues (separate task)
- Setting up ESLint (no config exists - separate task)
- Tailwind CSS diagnostics (no CLI tool available for v4)
- conform.nvim (it's a Neovim plugin, not a CLI tool)

## Approach

### Tools to Run

| Tool | Target | Command |
|------|--------|---------|
| `sv check` | `apps/dashboard/` | `bunx sv check --output machine-verbose` |
| `tsc --noEmit` | Root + packages | `bunx tsc --noEmit` |

### Why Not Other Tools?

- **conform.nvim**: Neovim plugin, not a CLI - cannot be "run" on codebase
- **tailwindcss-language-server**: No batch/CLI mode - IDE-only
- **eslint**: No config exists in project; would require full setup first
- **typescript-language-server**: Use `tsc` directly for batch diagnostics

### Key Files

- `apps/dashboard/svelte.config.js:1-26` - Svelte config with experimental features
- `apps/dashboard/tsconfig.json:1-14` - Dashboard TS config (strict mode)
- `tsconfig.json:1-31` - Root TS config
- `apps/dashboard/src/app.css:1-298` - Tailwind CSS 4 setup

### Known Issues

- `apps/dashboard/src/lib/stores/connection.svelte.ts` has ~7 type errors with river.ts imports
- Monorepo uses `workspace:*` dependencies
- Experimental Svelte features enabled: `async`, `remoteFunctions`

## Quick Commands

```bash
# Smoke test - run svelte-check on dashboard
cd apps/dashboard && bunx sv check --output human 2>&1 | head -50

# Full TypeScript check
bunx tsc --noEmit --pretty

# Machine-readable output for parsing
cd apps/dashboard && bunx sv check --output machine-verbose > /tmp/svelte-diagnostics.txt
```

## Acceptance Criteria

- [ ] `sv check` runs successfully and output is captured
- [ ] `tsc --noEmit` runs successfully and output is captured
- [ ] Diagnostics are categorized by severity (error/warning/hint)
- [ ] Summary of findings is documented
- [ ] No new errors introduced

## References

- [sv check docs](https://svelte.dev/docs/cli/sv-check)
- [sveltejs/language-tools](https://github.com/sveltejs/language-tools)
- [TypeScript noEmit](https://www.typescriptlang.org/tsconfig/noEmit.html)
