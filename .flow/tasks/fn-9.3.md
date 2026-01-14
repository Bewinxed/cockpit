# fn-9.3 Compile diagnostics summary

## Description
Compile all diagnostic outputs into a summary document.

## Summary should include

1. **Error counts by tool**
   - sv check: X errors, Y warnings
   - tsc: X errors

2. **Errors by category**
   - Type errors
   - Svelte-specific (runes, a11y)
   - Import/module resolution
   - CSS/styling

3. **Errors by file/package**
   - Most problematic files
   - Package-level breakdown

4. **Recommendations**
   - Which errors are blocking vs. low priority
   - Suggested fixes or follow-up tasks
   - Whether ESLint setup would add value

## Output format

Human-readable markdown summary with:
- Executive summary (1-2 sentences)
- Detailed breakdown tables
- Actionable next steps
## Acceptance
- [ ] Summary includes total error/warning counts
- [ ] Errors are categorized by type
- [ ] Most problematic files are identified
- [ ] Actionable recommendations are provided
## Done summary
TBD

## Evidence
- Commits:
- Tests:
- PRs:
