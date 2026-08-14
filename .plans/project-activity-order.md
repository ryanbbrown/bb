# Project activity order

## Goal

Add a browser-local project order setting for the project-organized sidebar.

The setting has two values:

- `Recent activity` orders project groups by their thread activity.
- `Manual` keeps the current drag order.

The projectless Threads section participates in recent activity ordering as a project group.

## Agreed behavior

- Use `Drag order` as the default for a browser without a saved preference.
- Apply that default to existing browsers without the new preference key.
- Preserve every existing manual order so the user can restore it.
- Keep the existing thread order setting unchanged.
- Rank groups with the existing default thread activity comparator.
- Ignore the selected thread row sort when ranking project groups.
- Consider every visible, unarchived, non-pinned descendant thread in a group.
- Put a group with an active thread before groups without active threads.
- Order two active groups by their newest active thread's `createdAt` value.
- Otherwise, use the newest `latestAttentionAt` value through the existing comparator.
- Exclude pinned threads because the Pinned section displays them separately.
- Keep the Pinned section first when recent activity ordering is active.
- Sort the projectless Threads section together with standard projects.
- Put groups without eligible threads after groups with eligible threads.
- Preserve manual relative order when two groups have no eligible threads.
- Disable top-level dragging while recent activity ordering is active.
- Restore the saved manual order when the user selects `Manual`.
- Store only the order mode in browser local storage.
- Do not change server contracts, database schemas, or daemon messages.
- Treat this browser-only display preference as exempt from SDK and CLI surfaces.
- This exception follows the existing browser-only sidebar display preferences.

## Implementation

### 1. Add the browser-local preference

- Add a `SidebarProjectOrder` type with `recent` and `manual` values.
- Add a stored atom beside the existing sidebar display atoms.
- Use a new, specific local-storage key.
- Default the atom to `manual`.
- Validate stored values with `createLocalStorageEnumStorage`.
- Resolve an invalid stored value to `manual`.

### 2. Add the display option

- Add a `Section order` group to `SidebarDisplayOptionsMenu` in project organization mode.
- Add `Recent activity` and `Drag order` choices.
- Keep the existing `Sort by` choices scoped to thread rows.
- Update `SidebarViewOptionsMenu.stories.tsx` to seed and show the new state.

### 3. Derive recent activity order

- Add a small pure helper for project-mode group ordering.
- Give the helper each group id, its threads, the effective pinned ids, and the normalized manual order.
- Filter every group with `isSidebarProjectThread` and the effective pinned id set.
- Exclude effective pinned descendants even when their own `pinnedAt` is null.
- Handle an empty thread list without reducing an empty array.
- Find each group's highest-ranked thread with one pass and `compareStandardThreads`.
- Compare groups by their highest-ranked threads.
- Use normalized manual positions as the empty-group fallback.
- Put an unknown group after every group found in normalized manual order.
- Include Pinned first only when `showPinnedSection` is true.
- Follow Pinned with all activity-ordered project groups and Threads.
- Keep this result derived in `useMemo`; do not persist the derived order.

### 4. Integrate ordering with project mode

- Keep `useSidebarModeSectionOrder` as the owner of normalized manual order.
- Build each group from all of its project threads, including nested descendants.
- Treat `threads` as the group id for the personal project thread list.
- Render the derived order only when the preference is `recent`.
- Render the normalized persisted order when the preference is `manual`.
- Extend the existing `reorderDisabled` value to cover recent mode.
- Pass that value to every built-in section and every project row.
- Keep `reorderOrder` connected to persisted manual order while dragging is disabled.
- Keep collapse, selection expansion, and nested thread ordering unchanged.

## Tests

Add focused tests at the pure ordering seam.

- A newer idle thread moves its project before an older project.
- An active thread moves its project before idle projects through existing comparator behavior.
- Two active groups use their newest active thread's creation time.
- The selected alphabetical or created thread sort does not change group activity order.
- The projectless Threads group sorts among standard projects.
- A hidden thread does not affect its source project.
- An effective pinned descendant does not affect its source project.
- A nested eligible child can move its source project.
- Empty groups follow active groups and retain their manual relative order.
- A new group missing from manual order gets a deterministic last fallback.
- Pinned remains first in recent mode when it exists.
- Pinned is omitted when it does not exist.
- Manual mode returns the persisted normalized order unchanged.

Add a component test for the display option.

- The menu changes the browser-local project order atom.
- The project order controls appear only in project organization mode.
- Invalid stored values resolve to drag order.

Add a project-mode integration test.

- Recent mode renders the derived project and Threads order.
- Recent mode disables every top-level reorder binding.
- Switching to recent mode does not overwrite `sidebarSectionOrderAtom`.
- Switching back to drag order renders the saved normalized order.

Do not add snapshot-only or drag-framework tests.

## Validation

Run these commands from the repository root:

```text
pnpm exec turbo run test --filter=@bb/app --force > /tmp/bb-project-activity-order-test.txt 2>&1
pnpm exec turbo run typecheck --filter=@bb/app
pnpm exec turbo run lint --filter=@bb/app
```

Read the complete test output file after the test command finishes.

## Acceptance checks

- Drag order is the default project order for a new browser profile.
- Idle group order follows the newest eligible thread attention value.
- Active groups follow the existing active thread bucket and creation-time order.
- Activity in a projectless thread can move the Threads group.
- Nested child activity can move its group.
- Pinned stays first when present and does not affect project activity.
- Manual mode preserves drag ordering and restores its previous saved order.
- Switching modes does not overwrite the saved manual order.
- The setting remains browser-local.
- Existing nested thread ordering behaves exactly as before.
