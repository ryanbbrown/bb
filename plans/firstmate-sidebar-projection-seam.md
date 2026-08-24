# Plan: minimal native sidebar projection seam + external Firstmate plugin

Approved architecture: Option B from `/Users/ryanbrown/code/bb-firstmate-sidebar-options.md`.
Revised after plan-review panel v1 — see
`.reviews/plans/firstmate-sidebar-projection-seam/firstmate-sidebar-projection-seam-synthesis-v1.md`.

## Base

- Branch `bb/firstmate-sidebar-seam-thr_pzfeeh2qfs`, cut from `personal`
  `d77da8e393d05670fc84be8d0e81bdb9312113df`.
- `upstream/main` `5205d98a74ed5a22469e521cf1f86b00b8232827`; `personal` 0 behind, 33 ahead.
- Worktree clean at branch creation.

## Goal

A plugin declares **organization only** (region and thread IDs). BB renders every pixel with its
existing native components. The Firstmate plugin lives **outside** this repo.

Not a goal: porting the 48-file prototype. It is a reference for logic only.

## Scope

### In the repo (the seam) — budget ≤ 16 files

| File | Change |
| --- | --- |
| `packages/plugin-sdk/src/app-contract.ts` | additive: projection + region types; two **required** props on `PluginThreadListProps` — `experimental_SidebarThreadProjection`, `experimental_isSearchFieldOpen` |
| `apps/app/src/components/sidebar/sidebarThreadProjection.ts` | **new** — pure validation/canonicalization |
| `apps/app/src/components/sidebar/sidebarThreadProjection.test.ts` | **new** |
| `apps/app/src/components/sidebar/SidebarThreadProjectionRenderer.tsx` | **new**, self-contained |
| `apps/app/src/components/sidebar/SidebarThreadProjectionRenderer.test.tsx` | **new** |
| `apps/app/src/components/sidebar/PluginThreadList.tsx` | pass both new props |
| `apps/app/src/components/sidebar/AppSidebar.tsx` | pass `threadSearch.isActive` through (1 line) |
| `docs/api_to_audit.md` | one entry per new `experimental_` member |
| `docs/plugin-sidebar-thread-list.md` | update the reproduced `PluginThreadListProps` + document the seam |
| `apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/SKILL.md` | update the reproduced props block |
| `packages/plugin-sdk/src/testing/app.tsx` | **only if required** — verify first, drop if not |

### Explicitly out of scope

- `ProjectList.tsx`, `ProjectRow.tsx`, `SidebarWindowedItems.tsx` — no edits at all.
- The prototype's new extractions: `SidebarProjectedDisplayOptionsMenu`,
  `buildNativeProjectThreadTreeItems`, `ProjectThreadTreeEmptyState`.
- `examples/plugins/**` (t3sidebar is deleted upstream; leave it deleted), `ui/sidebar.tsx`,
  `packages/client-core/**`, `theme.css`, `turbo.json`, `pnpm-lock.yaml`, `CHANGELOG.md`,
  `plans/composable-native-sidebar-projection.md`.
- **No SDK version bump** (see D1).

### Outside the repo

`~/code/bb-plugin-firstmate-sidebar/` — ported from the prototype's
`examples/plugins/firstmate-sidebar/`, depending on the local SDK build via a packed tarball or
`file:` reference. Zero repo files, therefore zero merge conflicts, permanently.

## Decisions

**D1 — no SDK version bump.** The host gate compares **majors only**, `PLUGIN_SDK_MAJOR` is 0,
and `plugin-sdk-version.ts` states the gate is "intentionally vacuous" pre-1.0;
`engines.bbPluginSdk` is a floor within the major. A patch bump buys nothing, and since
publishing is prohibited, `0.4.16` would not exist for the external plugin to pin. Dropping it
removes the only guaranteed upstream conflict.

**D2 — eligibility is `isSidebarProjectThread` (`visibility !== "hidden"`), enforced host-side.**
`isArchived` is **always false** in the SDK view: the bootstrap already fetches
`{ archived: false }` (`routes/projects.ts:220`) and `isArchived` maps from `archivedAt`
(`plugin-sidebar-threads.ts:82`). `visibility` is not exposed to plugins, so the *renderer*
applies the native filter and validation treats a hidden thread id as unresolvable. The external
plugin must not reference `thread.visibility`.

**D3 — reuse `ThreadTreeNodeRow`, not bare `ThreadRow`.** Verified exported and usable:
`ThreadTreeNodeRow` (`ProjectRow.tsx:1590`), `ProjectListShell` (`ProjectList.tsx:970`),
`SidebarDisplayOptionsMenu` (`ProjectList.tsx:676`), `TopLevelSidebarSection`,
`SidebarStickyStack/Tier/Group`, `SidebarWindowedItems`, and from `@bb/client-core`
`buildProjectThreadGroups`, `buildChronologicalThreadList`,
`collectProjectThreadItemNavigationEntries`, `ProjectThreadItem`. Importing these changes no
file, so it costs no conflicts.

`ProjectThreadTree` is **not** usable: it hardcodes `buildProjectThreadGroups` and one
`projectId`, so it cannot serve `nesting: "flat"` or cross-project regions. The renderer supplies
a small recursion wrapper in place of the private `SectionThreadTreeItems`
(`ProjectRow.tsx:1812`) and nothing more. Row-level glue stays native via `ThreadTreeNodeRow`.

The renderer needs `ThreadListEntry`, not `PluginSidebarThread`; it calls `useSidebarNavigation()`
directly (`useThreadEntryMap` is not exported).

**D4 — the Display options menu must be re-mounted by the renderer.** Verified: it renders inside
`ProjectList` (via `SidebarThreadsSectionActions:784` and `ProjectListComponent:1554`), **not** in
the surviving host chrome `ProjectListActionButtons:845`. Without this, the thread-numbers toggle
disappears under a projection. `SidebarDisplayOptionsMenu` is already exported, so mount it
directly — no `ProjectList` edit. Menu items that a projection makes inert are a recorded
deferred finding, not a refactor trigger.

**D5 — implement every region field end to end.** `id`, `label`, `placement`, `dividerAfter`,
`collapsible`, `nesting`, `grouping`, `threadOrder`, plus `excludedThreadIds`. AGENTS.md forbids
accepted-but-ignored fields: implement each or delete it. Limits, ported from the prototype: 64
regions, 50 000 thread references, 10 000 project references, 256-char text, 320-char diagnostic.

**D6 — completeness is strict full replacement.** Every eligible thread appears exactly once
across `regions` or in `excludedThreadIds`. Any uncovered eligible thread fails validation and
falls back. Threads must never silently vanish.

**D7 — search bypasses the projection whenever the field is open**, matching native
`ProjectList`, which swaps its body on `isActive` regardless of query. Requires the new
`experimental_isSearchFieldOpen` prop, because `searchQuery === ""` cannot distinguish
"closed" from "open and empty".

**D8 — invalid projections fall back, never crash.** Validation is atomic against the current
snapshot. On failure render the original native list plus **one** bounded, deduplicated
diagnostic. Recorded: a host-side throw inside the renderer surfaces as "Sidebar plugin crashed"
and attributes it to the plugin.

## Acceptance checks

1. `git merge-tree --write-tree upstream/main@5205d98a74e <branch>` → **0 conflicting paths**
   (prototype baseline: 10). Primary metric.
2. Changed repo files ≤ 16, and none is `ProjectList.tsx`, `ProjectRow.tsx`,
   `SidebarWindowedItems.tsx`, or under `examples/plugins/`.
3. Native behavior preserved through real native components: rows, indicators and a11y labels,
   context menus, inline rename, archive/delete confirmation, split click and drag, collapse,
   keyboard navigation, compact layout, **thread numbers**, and the **Display options menu**.
4. Hidden threads (`visibility: "hidden"`) never render in a projected region, matching native.
5. Search bypasses the projection with the field open at **both** empty and non-empty query.
6. Validation rejects duplicates within and across regions, unknown thread/project ids, uncovered
   eligible threads, malformed enums, and each defined limit — each falling back with exactly one
   diagnostic.
7. The external plugin builds and its tests pass outside the repo against a packed tarball or
   `file:` SDK reference. Verified manually; not gated by this repo's CI.

## Required tests

- **Thread numbers in DOM order 1..9 across region boundaries** — numbering is DOM-order based
  (`sidebarThreadShortcuts.ts:50-104`), so a reordered region or portal breaks it silently.
- Hidden / visible / archived eligibility parity with the native list.
- Search open+empty and open+non-empty; closed renders the projection.
- Row behaviors against the **real** providers, following `ThreadRow.test.tsx`: context menu,
  inline rename, archive confirmation.
- Compact viewport.
- Validation matrix per acceptance 6, plus diagnostic deduplication across re-renders.
- Recovery from an invalid projection to a valid one.

## Validation

- `pnpm exec turbo run typecheck --filter=@bb/app --filter=@get-bb/plugin-sdk`
- `pnpm exec turbo run test --filter=@bb/app` (includes `AppSidebar.test.tsx`,
  `ProjectList.modes.test.tsx`, `ThreadRow.test.tsx`)
- `pnpm exec turbo run test --filter=@get-bb/plugin-sdk`
- `pnpm exec turbo run typecheck` repo-wide
- Pipe slow output to a file and read the file, per AGENTS.md.
- Re-run the merge-tree conflict count after the final commit.

## Prohibited

No push, no publish, no install into the running BB, no rebuild of the active app, no merge into
`personal`.
