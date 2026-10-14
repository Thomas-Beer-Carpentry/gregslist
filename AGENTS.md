<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Gregslist

Treat PROJECT_BRIEF.md as the product source of truth. Implement one verified phase at a time. See docs/architecture.md for assumptions and scope. Preserve the exact five brand colours.

Use the existing checkout; cloud tasks are already isolated. Do not create worktrees unless requested. Run npm ci, then python scripts/prepare-vfs-images.py when Docker uses vfs. Use npm run db:start and npm run db:stop so local containers receive the project's isolated Docker settings. See docs/setup.md for local Auth setup.

Keep privileged Supabase credentials server-only. Content mutation privileges are intentionally withheld until their feature phases supply transactional APIs. Never enable public registration or weaken RLS to make a test pass.

Verify relevant changes with npm run typecheck, npm run build, npm run format:check, npm run db:test, npm test and npm run test:e2e. Never print .env.local or .local-admin.json values. Do not deploy, push or apply production migrations without explicit authorization.
