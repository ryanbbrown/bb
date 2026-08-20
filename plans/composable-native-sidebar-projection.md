# Composable Native Sidebar Projection

## Goal

Let a plugin change sidebar organization without rebuilding BB's sidebar UI.
The plugin declares thread membership, filtering, order, regions, and grouping.
BB renders the complete native project headings and thread rows, including all
current and future status, draft, menu, navigation, split, responsive,
accessibility, and virtualization behavior.

The existing `app.slots.experimental_threadList` replacement remains available
for plugins that intentionally own custom markup. Existing provider selection,
Automatic arbitration, and `experimental_Original` fallback remain unchanged.

## Current State

The worktree is based on current `upstream/main` at
`e2749bc137bd82c4fe8febb4d89625a261cb1dff`. The plugin SDK version is `0.4.10`.
The relevant sidebar contract is unchanged from the scoped design:

- `PluginThreadListProps` exposes list context and all-or-nothing
  `experimental_Original`.
- `experimental_useSidebarThreads` exposes semantic data but explicitly asks
  plugins to draw their own status glyphs and omits per-client draft state.
- `ThreadRow`, project headings, native search, shortcut behavior, split maps,
  menus, and `SidebarWindowedItems` remain app-internal.
- `examples/plugins/firstmate-sidebar` is preserved in the commit before this
  plan. It currently implements custom rows and will migrate to ID-only native
  projection during this work.

## Interface

Add one bound host-owned renderer to `PluginThreadListProps`:

```ts
interface PluginThreadListProps {
  // Existing fields remain unchanged.
  experimental_SidebarThreadProjection: ComponentType<{
    projection: PluginSidebarThreadProjection;
  }>;
}

interface PluginSidebarThreadProjection {
  regions: readonly PluginSidebarThreadProjectionRegion[];

  /**
   * Every eligible visible, non-archived thread must occur exactly once in a
   * region or in this exclusion list.
   */
  excludedThreadIds: readonly string[];
}

interface PluginSidebarThreadProjectionRegion {
  /** Stable within one thread-list registration. */
  id: string;
  /** Null renders no region heading. */
  label: string | null;
  placement: "sticky" | "flow";
  dividerAfter: boolean;
  collapsible: boolean;
  nesting: "flat" | "native";
  grouping:
    | { kind: "none" }
    | {
        kind: "project";
        projectOrder: readonly string[];
        collapsible: boolean;
        showEmptyProjects: boolean;
      };
  /** Exact source order before native parent-tree projection. */
  threadOrder: readonly string[];
}
```

The renderer is bound to the active sidebar instance, like
`experimental_Original`. It is not a global UI-kit export. A plugin can use
ordinary React hooks, settings, RPC state, and memoization before passing one
projection to the host.

## Projection Rules

- Region order is authoritative.
- Sticky regions must precede flow regions. BB owns sticky stacking.
- `threadOrder` is authoritative for flat rows and sibling order in native
  nesting.
- `grouping: "none"` renders native rows without project headings.
- `grouping: "project"` renders real native project headings in
  `projectOrder`. Flat nesting groups by each thread's own project. Native
  nesting uses BB's native parent-tree and cross-project rules.
- Empty project groups are omitted unless `showEmptyProjects` is true.
- Pin and lifecycle state never override projection placement. Plugins can use
  `isPinned` and other DTO fields when they build the projection.
- The active route can be excluded. BB does not inject or move it.
- Host search bypasses the projection and renders the existing native Recent,
  active, archived, and full-text result surface with current keyboard and
  deep-link behavior.

## Validation And Fallback

Validate each projection atomically against the host's current eligible thread
and project snapshot.

Reject the complete projection when:

- the top-level shape or any discriminant is invalid;
- a region ID is blank or duplicated;
- a region label is blank when non-null;
- a sticky region follows a flow region;
- a thread is duplicated, unknown, stale, archived, hidden, or missing from
  both visible regions and `excludedThreadIds`;
- an exclusion is duplicated or also visible;
- a project ID is unknown or duplicated in `projectOrder`;
- a represented project is absent from `projectOrder`;
- a runtime value exceeds bounded region, thread, or diagnostic limits.

An invalid projection renders `experimental_Original` for that snapshot. It
logs one precise bounded diagnostic and shows a deduplicated toast per plugin
generation and failure reason. It retries when the plugin supplies a later
projection. It must not disable the plugin permanently for one transient stale
projection.

A plugin component throw keeps the existing replacement crash behavior: BB's
list replaces the failed plugin. A deliberate plugin fallback continues to
render `experimental_Original` directly. A valid projection that excludes all
threads renders a host-owned empty state.

## Native Rendering

The host renderer must reuse or extract the existing native modules. It must
not copy their CSS or interaction logic into a plugin adapter.

- `ProjectListShell` and sticky stack
- `TopLevelSidebarSection`
- native project heading, project actions, and new-thread flow from `ProjectRow`
- `ThreadRow`
- native prompt-draft state and thread/plugin indicator precedence
- native context/dropdown menus, confirmations, inline rename, and quick archive
- native active/open-in-split state and split drag behavior
- `SidebarWindowedItems` and placeholder navigation metadata
- current shortcut, focus, coarse-pointer, responsive, and accessibility paths

Projection-local collapse keys must include plugin ID, registration ID, region
ID, and project ID so repeated project groups and multiple providers do not
share state accidentally.

## Firstmate Migration

Replace the custom Firstmate list, rows, glyphs, badges, menu, portal, and split
hook with three ID-only regions:

1. Manager: headerless, sticky, divider after, no project grouping, flat.
2. Managed sessions: flow, project grouped, flat direct children.
3. Independent threads: flow, project grouped, flat remaining threads.

Use the configured manager thread ID only. Missing, archived, deleted,
duplicated, inaccessible, loading, or malformed manager state delegates to
`experimental_Original`. Preserve project-array order and source thread order.
Empty project groups stay hidden. Detached direct children move to Independent
on the next host snapshot. Do not rewrite stored titles.

Keep `examples/plugins/t3sidebar` unchanged as the raw custom-markup reference.

## Implementation Phases

### Phase 1 - Contract And Pure Projection Module

- Add public projection types and the bound renderer prop in
  `packages/plugin-sdk/src/app-contract.ts`.
- Add runtime-safe projection validation and canonicalization in a pure app
  module.
- Add bounded diagnostics and deterministic projection keys.
- Extend the SDK test harness to record submitted projections and render a
  semantic test adapter. The harness must not pretend to model native UI.

### Phase 2 - Host Renderer

- Bind a module-stable projection renderer in `PluginThreadList.tsx`.
- Pass private search-active context from `AppSidebar.tsx` so native search
  bypass is exact, including an active search with an empty query.
- Extract the smallest reusable native project-heading/content seam from
  `ProjectRow.tsx`.
- Render regions and rows through native modules and native windowing.
- Add projection-local collapse state and atomic fallback.

### Phase 3 - Tests

Add meaningful tests at the public or user-visible seam:

- pure validation: order, flat/native nesting, project grouping/order, explicit
  exclusions, duplicates, unknown/stale IDs, archived/hidden policy, empty
  groups, sticky ordering, bounded diagnostics, and atomic fallback;
- real host rendering: manager/standalone rows, repeated project groups,
  native project headings, active/open-in-split state, unread/error/running and
  plugin indicators, per-client draft precedence, menus/actions, confirmed
  delete, inline rename, keyboard attributes and next/previous order, split
  click/drag, responsive behavior, and accessible names;
- native search bypass for empty and non-empty queries;
- provider arbitration, deliberate Original delegation, component crash, and
  invalid-projection retry;
- virtualization and placeholder navigation with large fixtures, including a
  focused 10,000-thread projection performance guard and active-row retention;
- SDK harness inspection of the projection submitted by a plugin.

Do not duplicate low-value tests that only prove React or the harness.

### Phase 4 - Docs, Version, And Example

- Add the required `docs/api_to_audit.md` entry.
- Update `docs/plugin-sidebar-thread-list.md` and the built-in plugin-authoring
  skill with the native-projection path and its limits.
- Migrate Firstmate and rewrite its tests around projection and native behavior.
- Update any discoverable SDK/example documentation required by repository
  conventions.
- Follow the current SDK release convention. The current version is `0.4.10`;
  use the next repository-approved additive version rather than the earlier
  assumed `0.5.0`. Update every version source and lockfile consistently.
- Do not bump `HOST_DAEMON_PROTOCOL_VERSION`; this is frontend-only.

### Phase 5 - Validation And Isolated QA

Run focused tests while implementing, then full relevant validation through
Turbo:

- plugin SDK tests, typecheck, build, and bundled declaration generation;
- BB app focused and full test/typecheck/lint/build tasks required by changes;
- Firstmate tests, typecheck, lint, and `bb plugin build`;
- formatting and `git diff --check`;
- any additional affected shared package tasks.

Use only the disposable Firstmate QA data directory and ports. Rebuild and
reload the plugin only there. Compare BB built-in and Firstmate at the user's
narrow sidebar width, a compact phone viewport, and a wider viewport. Verify
real native running, unread, error/attention, idle, active, menu, project,
repeated-group, sticky-manager, and split behavior without provider/model calls
when fixture data can represent it safely.

## Review Workflow

Use the stable feature name `composable native sidebar projection` and the clean
pre-implementation SHA recorded after this plan commit.

Run exactly two implementation review-panel cycles:

1. Freeze cycle 1, read all reports, verify every finding, write synthesis v1,
   and resume the same implementation subagent for every verified fix.
2. Freeze cycle 2 after those fixes, read all reports, verify every finding,
   write synthesis v2, and resume the same implementation subagent for every
   verified fix.

Run full relevant validation after the final fixes. Do not run a plan review.

## Acceptance Checks

- Organization-only plugins render no custom project or thread row markup.
- Firstmate matches current native appearance and behavior at all required
  widths while retaining its required structure.
- Every projection field has defined validation, ordering, error, and
  performance semantics.
- Invalid or stale data cannot produce a partial, duplicate, dead, or blank
  sidebar.
- Existing raw thread-list plugins and provider arbitration remain compatible.
- Native search and all listed row behaviors remain host-owned.
- Tests prove risky behavior through real interfaces, not snapshots or mock
  theater.
- Documentation, API audit, test harness, and SDK version sources agree.
- No production BB server, `~/.bb`, GitHub item, PR, push, merge, deploy,
  release, or daemon protocol changes occur.
