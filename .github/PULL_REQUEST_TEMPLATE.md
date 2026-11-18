## What this changes

<!-- One or two sentences from the user's point of view. Link the issue it closes, if any. -->

## Checklist

- [ ] Tests cover the change and `npm test`, `npm run lint` and `npm run check` pass
- [ ] UI copy is English and emoji-free; icons are local SVGs
- [ ] Docs are updated where it matters: README feature list, `docs/deployment.md` (environment variables, operations), `.env.example` / `.env.dev.example`
- [ ] A user-visible change has a line in `src/lib/changelog.ts` for the next release
- [ ] A schema change ships its Drizzle migration (`npx drizzle-kit generate`)
- [ ] Nothing personal or infrastructure-specific (hostnames, addresses, names) is in the diff
