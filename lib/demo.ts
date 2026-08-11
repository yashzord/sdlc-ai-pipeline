import type { StageId } from "./stages";

// Realistic pre-scripted outputs used when no GEMINI_API_KEY is configured
// (or when the live call fails). Parameterized by the user's requirement so
// the demo still feels connected to what they typed.

function short(requirement: string): string {
  const r = requirement.trim().replace(/\s+/g, " ");
  return r.length > 80 ? r.slice(0, 77) + "..." : r;
}

export function demoOutput(stageId: StageId, requirement: string): string {
  const product = short(requirement);
  switch (stageId) {
    case "requirements":
      return `## Functional Requirements
1. **FR-1 — Core workflow**: Users can perform the primary action described in "${product}" end to end. *Rationale: this is the reason the product exists.*
2. **FR-2 — Account & auth**: Users sign up, sign in, and manage a profile. *Rationale: personalization and data ownership require identity.*
3. **FR-3 — Create/edit/delete**: Full CRUD on the core domain object. *Rationale: users must control their own data.*
4. **FR-4 — Search & filter**: Users can find items by keyword and key attributes. *Rationale: usability collapses past ~50 items without search.*
5. **FR-5 — Notifications**: Users receive in-app notifications for relevant events. *Rationale: re-engagement and workflow completion.*
6. **FR-6 — Admin dashboard**: Admins can view usage metrics and moderate content. *Rationale: operational control from day one.*

## Non-Functional Requirements
1. **NFR-1 — Performance**: p95 page load < 2s on 4G; API p95 < 300ms.
2. **NFR-2 — Security**: OWASP Top 10 mitigations; all traffic TLS; passwords hashed with a modern KDF.
3. **NFR-3 — Accessibility**: WCAG 2.1 AA for all user-facing flows.
4. **NFR-4 — Scalability**: Handle 10k MAU on a single region without re-architecture.
5. **NFR-5 — Availability**: 99.5% monthly uptime target for v1.

## Out of Scope
- Native mobile apps (responsive web only for v1)
- Multi-language/i18n support
- Third-party integrations beyond auth

## Open Questions
1. Who is the primary persona for launch, and what single metric defines success?
2. Is there existing data to migrate, or is this greenfield?
3. What is the monetization model — does it affect which features gate behind auth?

> _Demo mode: this is a pre-scripted illustrative output. Add a \`GEMINI_API_KEY\` to generate real analysis._`;

    case "stories":
      return `## Epic
Deliver a usable v1 of "${product}" that lets a first-time user complete the core workflow in under 5 minutes.

## User Stories
**US-1 — Sign up & onboarding** (points: 3)
As a new user, I want to create an account and see a guided first-run experience so that I reach the core value quickly.
Acceptance criteria:
- Email + OAuth sign-up both work
- First-run tour is dismissible and never shown again
- Landing after signup is the core workflow, not a settings page

**US-2 — Core workflow happy path** (points: 8)
As a user, I want to complete the primary task end to end so that I get the product's main value.
Acceptance criteria:
- Task completes in ≤ 3 steps
- State is persisted between sessions
- Success state is explicit and shareable

**US-3 — Manage my items** (points: 5)
As a returning user, I want to view, edit, and delete my items so that my workspace stays current.
Acceptance criteria:
- List view with pagination
- Edit is inline or single-screen; destructive actions confirm

**US-4 — Search & filter** (points: 3)
As a power user, I want keyword search and attribute filters so that I can find items fast.
Acceptance criteria:
- Results update in < 500ms; empty state suggests next action

**US-5 — Notifications** (points: 3)
As a user, I want in-app notifications for relevant events so that I return at the right time.
Acceptance criteria:
- Notification center with read/unread; per-event-type mute

**US-6 — Admin metrics** (points: 5)
As an admin, I want a dashboard of signups, activation, and retention so that I can steer the roadmap.
Acceptance criteria:
- Daily aggregates; CSV export

## Sprint Plan
**Sprint 1 (MVP):** US-1, US-2, US-3 — the smallest loop a user can love.
**Sprint 2:** US-4, US-5, US-6 — findability, re-engagement, operations.

> _Demo mode: pre-scripted output. Add a \`GEMINI_API_KEY\` for stories generated from your actual requirements._`;

    case "architecture":
      return `## System Overview
A modular monolith: a Next.js app serving both UI and API routes, backed by Postgres. Boring, proven, and deployable to Vercel in one step — microservices are explicitly deferred until scale demands them.

\`\`\`
Browser (React/Next.js)
  └─→ Next.js Route Handlers (/api/*)
        ├─→ Service layer (business logic)
        │     └─→ Postgres (via Prisma)
        ├─→ Auth (session cookies, OAuth provider)
        └─→ Background jobs (cron / queue for notifications)
\`\`\`

## Tech Stack
| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js + React + Tailwind | One framework for UI+API, fast iteration |
| API | Next.js Route Handlers | Zero extra infra, typed end to end |
| Database | Postgres (managed) | Relational fits the domain; free tiers exist |
| ORM | Prisma | Migrations + type safety |
| Auth | Auth.js (OAuth + email) | Battle-tested, no password storage burden |
| Hosting | Vercel | Git-push deploys, preview environments |

## Data Model
- **User**: id, email, name, role, createdAt
- **Item** (core domain object of "${product}"): id, ownerId → User, title, status, payload (jsonb), createdAt, updatedAt
- **Notification**: id, userId, type, readAt, createdAt

## API Design
- \`POST /api/items\` — create item; body: title, payload → 201 with item
- \`GET /api/items?query=&status=&page=\` — list/search owner's items → paginated items
- \`PATCH /api/items/:id\` — partial update → updated item
- \`DELETE /api/items/:id\` — soft delete → 204
- \`GET /api/notifications\` — unread-first list → notifications
- \`GET /api/admin/metrics\` — admin-only aggregates → daily counts

## Key Risks
1. **Auth complexity creep** — mitigate: Auth.js defaults only, no custom flows in v1.
2. **Unbounded jsonb payloads** — mitigate: schema-validate payload at the service layer; size cap 64KB.
3. **Single-region latency for far users** — mitigate: accept for v1; measure p95 by geo before adding edge caching.

> _Demo mode: pre-scripted output. Add a \`GEMINI_API_KEY\` for a design derived from your actual backlog._`;

    case "code":
      return `I chose the **item service layer** — it owns the core business logic (validation, ownership checks, soft delete) that every API route depends on, so it's the highest-leverage module to get right first.

\`\`\`typescript
// lib/services/item-service.ts
import { z } from "zod";

export const ItemPayload = z.record(z.string(), z.unknown());
export const CreateItemInput = z.object({
  title: z.string().min(1).max(200),
  payload: ItemPayload.refine(
    (p) => JSON.stringify(p).length <= 64_000,
    "payload exceeds 64KB"
  ),
});
export type CreateItemInput = z.infer<typeof CreateItemInput>;

export interface Item {
  id: string;
  ownerId: string;
  title: string;
  status: "active" | "archived" | "deleted";
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ItemRepo {
  insert(data: Omit<Item, "id" | "createdAt" | "updatedAt">): Promise<Item>;
  findById(id: string): Promise<Item | null>;
  update(id: string, patch: Partial<Item>): Promise<Item>;
}

export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}

export class ItemService {
  constructor(private repo: ItemRepo) {}

  async create(ownerId: string, input: unknown): Promise<Item> {
    const parsed = CreateItemInput.parse(input);
    return this.repo.insert({
      ownerId,
      title: parsed.title.trim(),
      status: "active",
      payload: parsed.payload,
    });
  }

  async softDelete(actorId: string, itemId: string): Promise<void> {
    const item = await this.repo.findById(itemId);
    if (!item || item.status === "deleted") throw new NotFoundError(itemId);
    if (item.ownerId !== actorId) throw new ForbiddenError("not the owner");
    await this.repo.update(itemId, { status: "deleted" });
  }
}
\`\`\`

> _Demo mode: pre-scripted output. Add a \`GEMINI_API_KEY\` to generate code for your actual architecture._`;

    case "review":
      return `## Verdict
**APPROVE WITH COMMENTS** — the ownership and validation model is sound, but two medium issues should be fixed before merge.

## Findings
1. **[bug] (med)** \`softDelete\` treats an archived item as deletable but never checks \`status === "archived"\` semantics — deleting an archived item silently skips any archive-specific cleanup. Fix: define an explicit allowed-transition map.
2. **[risk] (med)** \`CreateItemInput.payload\` size check serializes the payload twice (once in \`refine\`, again at persistence). On 64KB payloads this doubles CPU per request. Fix: serialize once, validate length, and pass the string through to the repo.
3. **[style] (low)** \`CreateItemInput\` is both a Zod schema and a type alias with the same name — legal, but confusing at call sites. Fix: name the schema \`createItemSchema\`.
4. **[perf] (low)** \`title.trim()\` after \`.parse\` means the length check runs on the untrimmed value; \`" a "\` passes min(1) but persists as \`"a"\`. Move \`.trim()\` into the schema with \`.transform\`.

## Security Notes
- Ownership check in \`softDelete\` is correct (fetch-then-compare), but ensure the repo's \`findById\` does not leak other users' items via timing differences — return 404 for both "missing" and "not yours" at the API layer.
- \`payload\` is stored as-is: ensure it is never rendered as HTML without sanitization or an XSS via stored payload is trivial.

## Test Focus
1. Ownership enforcement: non-owner delete must 404/403, never succeed.
2. Payload size boundary: exactly 64KB passes, 64KB+1 fails.
3. Status transitions: deleted items are invisible to every read path.

> _Demo mode: pre-scripted output. Add a \`GEMINI_API_KEY\` for a review of your actually generated code._`;

    case "tests":
      return `## Test Strategy
Unit tests target the service layer with an in-memory repo fake — fast, deterministic, and they exercise every high-severity review finding (ownership, payload boundary, status transitions) without a database.

\`\`\`typescript
import { describe, it, expect, beforeEach } from "vitest";
import { ItemService, ForbiddenError, NotFoundError, type Item, type ItemRepo } from "./item-service";

function makeRepo(): ItemRepo & { items: Map<string, Item> } {
  const items = new Map<string, Item>();
  let seq = 0;
  return {
    items,
    async insert(data) {
      const item: Item = { ...data, id: String(++seq), createdAt: new Date(), updatedAt: new Date() };
      items.set(item.id, item);
      return item;
    },
    async findById(id) { return items.get(id) ?? null; },
    async update(id, patch) {
      const cur = items.get(id)!;
      const next = { ...cur, ...patch, updatedAt: new Date() };
      items.set(id, next);
      return next;
    },
  };
}

describe("ItemService", () => {
  let repo: ReturnType<typeof makeRepo>;
  let svc: ItemService;
  beforeEach(() => { repo = makeRepo(); svc = new ItemService(repo); });

  it("creates an item with trimmed title", async () => {
    const item = await svc.create("u1", { title: "  hello  ", payload: {} });
    expect(item.title).toBe("hello");
    expect(item.status).toBe("active");
  });

  it("rejects an empty title", async () => {
    await expect(svc.create("u1", { title: "", payload: {} })).rejects.toThrow();
  });

  it("accepts a payload at the 64KB boundary", async () => {
    const payload = { d: "x".repeat(63_980) };
    await expect(svc.create("u1", { title: "t", payload })).resolves.toBeDefined();
  });

  it("rejects a payload over 64KB", async () => {
    const payload = { d: "x".repeat(64_100) };
    await expect(svc.create("u1", { title: "t", payload })).rejects.toThrow(/64KB/);
  });

  it("lets the owner soft delete", async () => {
    const item = await svc.create("u1", { title: "t", payload: {} });
    await svc.softDelete("u1", item.id);
    expect(repo.items.get(item.id)!.status).toBe("deleted");
  });

  it("forbids a non-owner from deleting", async () => {
    const item = await svc.create("u1", { title: "t", payload: {} });
    await expect(svc.softDelete("u2", item.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("404s on deleting an already-deleted item", async () => {
    const item = await svc.create("u1", { title: "t", payload: {} });
    await svc.softDelete("u1", item.id);
    await expect(svc.softDelete("u1", item.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("404s on deleting a missing item", async () => {
    await expect(svc.softDelete("u1", "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});
\`\`\`

## Coverage Gaps
- No integration tests against real Postgres (transaction behavior, concurrent updates).
- API-layer mapping of \`ForbiddenError\` → 404 is untested here.
- No property-based fuzzing of \`payload\` contents.

> _Demo mode: pre-scripted output. Add a \`GEMINI_API_KEY\` to generate tests for your actual code._`;

    case "release":
      return `## Release Notes — v0.1.0
**Highlights**
- First public release of "${product}"
- Complete core workflow: create, manage, and search your items
- Account sign-up with email and OAuth
- In-app notifications for key events

**Known limitations**
- Single region deployment; users far from it may see higher latency
- No mobile apps yet (responsive web works on phones)
- Admin metrics update daily, not in real time

## Deployment Checklist
- [ ] All CI checks green on the release commit
- [ ] Database migration dry-run against a production snapshot
- [ ] Environment variables verified in the production project (auth secrets, DB URL)
- [ ] Deploy to preview environment and run the smoke suite
- [ ] Promote to production during low-traffic window
- [ ] Verify health endpoint and p95 latency for 15 minutes post-deploy
- [ ] Rollback trigger: error rate > 2% or p95 > 1s sustained for 5 minutes → revert to previous deployment

## Monitoring
1. **API error rate** (alert at > 1% over 5 min) — first signal of a bad deploy.
2. **p95 request latency** (alert at > 500ms) — catches DB and cold-start regressions.
3. **Signup funnel completion** (daily) — the product metric that tells you v0.1 is landing.

> _Demo mode: pre-scripted output. Add a \`GEMINI_API_KEY\` for release notes generated from your actual pipeline run._`;
  }
}
