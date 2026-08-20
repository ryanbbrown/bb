# Firstmate sidebar

A lightweight presentation-only replacement for BB's scrolling thread list.
It keeps one configured Firstmate manager at the top, then shows managed and
independent threads in flat project groups.

This example is not bundled or listed in the plugin catalog. It does not create
threads, change parent links, suppress notifications, rename stored titles, or
run orchestration.

## Ownership rules

- **Firstmate manager** is the one thread whose exact ID matches the
  `managerThreadId` setting.
- **Managed sessions** are visible, non-archived direct children of that
  manager.
- **Independent threads** are all other visible, non-archived threads except
  the manager.

A detached child moves to Independent as soon as BB reports its new parent.
Grandchildren are Independent because ownership is direct. Each thread stays
under its own project when status, attention, or lifecycle state changes. The
manager's top placement is structural; its separate BB `isPinned` state and pin
action remain visible.
Projects with no matching visible thread are omitted from the projection, but
remain available in BB's normal new-thread flow.

The plugin uses the stored title as-is. For outcome-focused rows, give threads
short titles that state the result, such as `Reduce sidebar startup time` or
`Draft launch email`. The plugin does not guess or persist title rewrites.

## Configuration and fallback

Set `managerThreadId` to the manager's exact `thr_...` ID. Titles are not used
as identity because they are not unique or stable.

The plugin renders BB's bound `experimental_Original` list when the setting is
blank or unavailable, thread data is not ready, the manager is missing,
archived, deleted, or duplicated, IDs are ambiguous, or a real project name
cannot be resolved. It never replaces an invalid state with a blank sidebar.

## Build and test without a server

From the repository root:

```sh
pnpm exec turbo run test --filter=bb-plugin-firstmate-sidebar --force
pnpm exec turbo run typecheck --filter=bb-plugin-firstmate-sidebar
pnpm exec turbo run lint --filter=bb-plugin-firstmate-sidebar
BB_DATA_DIR="$(mktemp -d)/bb-data" pnpm bb plugin build ./examples/plugins/firstmate-sidebar
```

`bb plugin build` talks to no server. Do not run `bb plugin dev`, install the
plugin, or reload a plugin when you only need build validation.

## Later visual QA in a separate BB environment

Use a disposable data directory and ports that are not used by the normal BB
server. Run these commands in a separate shell from the repository root:

```sh
export FIRSTMATE_QA_DIR="$(mktemp -d)"
export BB_DATA_DIR="$FIRSTMATE_QA_DIR/data"
printf 'Isolated QA directory: %s\n' "$FIRSTMATE_QA_DIR"
pnpm start -- --data-dir "$BB_DATA_DIR" --server-port 39986 --host-daemon-port 39987
```

Keep that process running. In another shell, copy the printed directory value,
then set the isolated CLI target, install the path copy, and configure it:

```sh
export FIRSTMATE_QA_DIR="<the printed isolated QA directory>"
export BB_DATA_DIR="$FIRSTMATE_QA_DIR/data"
export BB_SERVER_URL="http://127.0.0.1:39986"
export BB_HOST_DAEMON_PORT="39987"
pnpm bb plugin install path:"$PWD/examples/plugins/firstmate-sidebar" --yes
pnpm bb plugin config firstmate-sidebar set managerThreadId thr_REPLACE_ME
```

Open `http://127.0.0.1:39986`, then select **Firstmate sidebar** in
**Settings → Appearance → Sidebar**. Create or import representative threads in
this disposable environment. Use BB's normal parenting action or CLI to attach
and detach direct children. Check:

1. exact left-edge alignment at desktop and compact widths;
2. host search filtering and clearing after open;
3. numbered and next/previous keyboard shortcuts;
4. Cmd/Ctrl-click and drag-to-split;
5. unread, pin, attention, active, and other-pane states;
6. the visible action menu and BB's delete confirmation;
7. fallback after blanking the setting or archiving/deleting the manager.

Stop the isolated server when done, then remove `$FIRSTMATE_QA_DIR`. These steps
do not use or modify `~/.bb`.

## SDK limits

The public SDK provides thread data, actions, split bindings, and keyboard-row
attributes, but no native thread row, status component, or action-menu
component. This plugin owns that presentation. It cannot reproduce BB's private
search-result Arrow/Enter controller, native shortcut badges, content-message
search, or status data that is not included in `PluginSidebarThread`.

This MVP mounts every visible row. The SDK does not expose the host's virtual
row placeholder contract, so a plugin cannot both window a very large list and
preserve next/previous keyboard navigation across unmounted rows using only
public APIs. Test performance with a large disposable dataset before wider use.
