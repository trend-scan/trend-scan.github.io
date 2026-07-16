# Pull Request

## Summary

<!-- 1-3 sentences: what does this PR change and why? -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Refactor / cleanup
- [ ] Data source addition (new exchange / API)
- [ ] Universe change (added/removed tickers)
- [ ] Breaking change (fix or feature that would change existing behavior)

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `python3 scripts/verify-csp.py` passes (if any new external URL was added)
- [ ] Tested locally on at least one browser
- [ ] If new env vars were added, they're documented in `src/vite-env.d.ts`
- [ ] If new exchange APIs were added, they're added to the CSP `connect-src` in `index.html`

## Screenshots / context

<!-- If the change is visual, include before/after screenshots. -->
<!-- If the change affects data flow, describe what page/tab is affected. -->

## Related issues

<!-- e.g. Fixes #123, Closes #456 -->
