# Firstmate sidebar

An ID-only organization plugin for BB's native sidebar. It keeps one configured Firstmate manager at the top, then asks BB to render managed and independent threads in flat project groups.

The plugin does not render project headings, thread rows, glyphs, badges, menus, portals, or split controls. BB owns all native appearance and behavior, including status and per-client draft precedence, actions and confirmations, inline rename, search, shortcuts, split click and drag, responsive accessibility, collapse, and windowing.

This example is not bundled or listed in the plugin catalog. It does not create threads, change parent links, suppress notifications, rename stored titles, or run orchestration.

## Ownership rules

- **Firstmate manager** is the one thread whose exact ID matches `managerThreadId`.
- **Managed sessions** are visible, non-archived direct children of that manager.
- **Independent threads** are all other visible, non-archived threads except the manager.

A detached child moves to Independent on the next host snapshot. Grandchildren are Independent because ownership is direct. Project-array order and source-thread order stay authoritative. Empty project groups stay hidden. Pin and lifecycle changes do not move rows. Stored titles are not changed.

The three projection regions are:

1. headerless sticky Manager, with a divider;
2. flow Managed sessions, flat and project-grouped;
3. flow Independent threads, flat and project-grouped.

## Configuration and fallback

Set `managerThreadId` to the manager's exact `thr_...` ID. Titles are not identity.

The plugin renders its bound `experimental_Original` list when the setting or thread snapshot is unavailable or malformed, or when the manager is missing, archived, deleted, inaccessible, or duplicated. BB also validates each submitted projection atomically against its current thread and project snapshot. Stale or invalid IDs render the original list with one bounded, deduplicated diagnostic; a later projection is retried.

Host search bypasses the projection. This includes an open search field with an empty query, so Recent, active, archived, full-text results, keyboard selection, and deep links stay native.

## Build and test without a server

From the repository root:

```sh
pnpm exec turbo run test --filter=bb-plugin-firstmate-sidebar --force
pnpm exec turbo run typecheck --filter=bb-plugin-firstmate-sidebar
pnpm exec turbo run lint --filter=bb-plugin-firstmate-sidebar
BB_DATA_DIR="$(mktemp -d)/bb-data" pnpm bb plugin build ./examples/plugins/firstmate-sidebar
```

`bb plugin build` talks to no server. Do not run `bb plugin dev`, install the plugin, or reload a plugin when build validation is sufficient.

The SDK harness records the value at `inspection.sidebarThreadProjections` and renders a semantic region/project/thread ID adapter. It does not simulate native UI. Native row behavior is tested in the BB app.

## Isolated visual QA

If visual QA is required, use a disposable data directory and ports that are not used by a normal BB server:

```sh
export FIRSTMATE_QA_DIR="$(mktemp -d)"
export BB_DATA_DIR="$FIRSTMATE_QA_DIR/data"
export BB_SERVER_URL="http://127.0.0.1:39986"
export BB_HOST_DAEMON_PORT="39987"
pnpm start -- --data-dir "$BB_DATA_DIR" --server-port 39986 --host-daemon-port 39987
```

In another shell with the same variables, install only into that isolated server and set the exact manager ID. Check a narrow desktop sidebar, compact phone viewport, and wide viewport. Verify running, unread, error or attention, idle, active, menu, project, repeated-group, sticky-manager, collapse, search, and split behavior. Stop the isolated server and remove `$FIRSTMATE_QA_DIR` afterward. Never use or modify `~/.bb` for this QA.

[`examples/plugins/t3sidebar`](../t3sidebar) remains the reference for a replacement that intentionally owns custom markup.
