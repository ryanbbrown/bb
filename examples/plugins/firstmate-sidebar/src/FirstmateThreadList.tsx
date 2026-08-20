import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  experimental_useSidebarThreads as useSidebarThreads,
  useSettings,
  type PluginSidebarProject,
  type PluginSidebarThread,
  type PluginSidebarThreadActions,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import {
  projectFirstmateThreads,
  threadDisplayTitle,
  type FirstmateProjectGroup,
} from "./projection";

export const FIRSTMATE_FLAT_EDGE_CLASS = "firstmate-flat-edge px-2";

export function FirstmateThreadList(props: PluginThreadListProps) {
  const state = useSidebarThreads();
  const settings = useSettings();
  const managerThreadId = settings.values?.managerThreadId;

  if (settings.isLoading || typeof managerThreadId !== "string") {
    return <props.experimental_Original />;
  }

  const result = projectFirstmateThreads(
    state,
    managerThreadId,
    props.searchQuery,
  );
  if (result.kind === "fallback") {
    return <props.experimental_Original />;
  }

  const { manager, managedGroups, independentGroups } = result.projection;
  const projectById = new Map(
    state.projects.map((project) => [project.id, project]),
  );
  const hasSearchResults =
    manager !== null ||
    managedGroups.length > 0 ||
    independentGroups.length > 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-2">
      {manager ? (
        <div
          data-firstmate-region="manager"
          className="sticky top-0 z-10 bg-sidebar pt-1"
        >
          <ul className="m-0 list-none p-0">
            <ThreadRow
              thread={manager}
              project={projectById.get(manager.projectId)!}
              activeThreadId={props.activeThreadId}
              onNavigate={props.onNavigate}
              manager
            />
          </ul>
          <div
            role="separator"
            aria-label="Firstmate manager divider"
            className="mx-2 mt-1 h-px bg-sidebar-border"
          />
        </div>
      ) : null}

      <ThreadRegion
        label="Managed sessions"
        groups={managedGroups}
        activeThreadId={props.activeThreadId}
        onNavigate={props.onNavigate}
      />
      <ThreadRegion
        label="Independent threads"
        groups={independentGroups}
        activeThreadId={props.activeThreadId}
        onNavigate={props.onNavigate}
      />

      {!hasSearchResults ? (
        <p
          role="status"
          className="px-2 py-6 text-center text-xs text-muted-foreground"
        >
          {props.searchQuery.trim() ? "No threads found" : "No threads yet"}
        </p>
      ) : null}
    </div>
  );
}

function ThreadRegion({
  label,
  groups,
  activeThreadId,
  onNavigate,
}: {
  label: string;
  groups: readonly FirstmateProjectGroup[];
  activeThreadId: string | null;
  onNavigate: () => void;
}) {
  return (
    <section aria-label={label} className="pt-3">
      <h2
        data-firstmate-flat-edge=""
        className={`${FIRSTMATE_FLAT_EDGE_CLASS} text-xs font-semibold text-foreground`}
      >
        {label}
      </h2>
      <div className="mt-2 space-y-3">
        {groups.map((group) => (
          <ProjectGroup
            key={group.project.id}
            group={group}
            activeThreadId={activeThreadId}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </section>
  );
}

function ProjectGroup({
  group,
  activeThreadId,
  onNavigate,
}: {
  group: FirstmateProjectGroup;
  activeThreadId: string | null;
  onNavigate: () => void;
}) {
  return (
    <section aria-label={group.project.name} data-firstmate-project-group="">
      <h3
        data-firstmate-flat-edge=""
        className={`${FIRSTMATE_FLAT_EDGE_CLASS} flex items-center gap-1.5 text-sm font-semibold text-foreground`}
      >
        <span
          data-firstmate-leading-edge=""
          className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"
        >
          <Glyph kind="project" />
        </span>
        <span className="min-w-0 truncate">{group.project.name}</span>
      </h3>
      <ul className="mt-1 m-0 list-none p-0">
        {group.threads.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            project={group.project}
            activeThreadId={activeThreadId}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </section>
  );
}

function ThreadRow({
  thread,
  project,
  activeThreadId,
  onNavigate,
  manager = false,
}: {
  thread: PluginSidebarThread;
  project: PluginSidebarProject;
  activeThreadId: string | null;
  onNavigate: () => void;
  manager?: boolean;
}) {
  const actions = useSidebarThreadActions();
  const { splitProps, isAvailable, layout } = useSidebarThreadSplit(thread.id);
  const title = threadDisplayTitle(thread);
  const isActive = thread.id === activeThreadId;
  const statusLabel = knownIndicatorLabel(thread);

  return (
    <li
      data-firstmate-flat-edge=""
      data-firstmate-thread-row={thread.id}
      className={`${FIRSTMATE_FLAT_EDGE_CLASS} list-none`}
    >
      <div
        className={[
          "group/row relative flex min-h-11 items-center rounded-md transition-colors",
          isActive
            ? "bg-sidebar-accent"
            : layout !== null
              ? "bg-sidebar-accent/30 hover:bg-sidebar-accent/60"
              : "hover:bg-sidebar-accent/60",
        ].join(" ")}
      >
        <a
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          href="#"
          aria-label={title}
          aria-current={isActive ? "page" : undefined}
          {...splitProps}
          onClick={(event) => {
            event.preventDefault();
            actions.open(thread.id, {
              split: event.metaKey || event.ctrlKey,
            });
            onNavigate();
          }}
          className="absolute inset-0 cursor-pointer rounded-md"
        />
        <span
          data-firstmate-leading-edge=""
          className="pointer-events-none relative flex size-5 shrink-0 items-center justify-center text-muted-foreground"
        >
          <Glyph kind={manager ? "manager" : "thread"} />
        </span>
        <span className="pointer-events-none relative min-w-0 flex-1 py-1.5 pl-1.5">
          <span
            className={`flex items-center gap-1 truncate text-sm text-foreground ${thread.isUnread ? "font-semibold" : "font-normal"}`}
          >
            <span className="truncate">{title}</span>
            {manager || thread.isPinned ? (
              <span
                aria-label={manager ? "Manager fixed at top" : "Pinned thread"}
                className="inline-flex shrink-0 text-muted-foreground"
              >
                <Glyph kind="pin" />
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex min-h-4 items-center gap-1 text-2xs text-muted-foreground">
            {manager ? <Badge>Firstmate manager</Badge> : null}
            {manager ? (
              <span className="min-w-0 truncate">{project.name}</span>
            ) : null}
            {manager && thread.isPinned ? (
              <Badge ariaLabel="Pinned thread">Pinned in BB</Badge>
            ) : null}
            {statusLabel ? (
              <Badge ariaLabel={statusLabel}>{statusLabel}</Badge>
            ) : thread.hasPendingInteraction ? (
              <Badge ariaLabel="Thread needs attention">Needs attention</Badge>
            ) : null}
            {thread.isUnread ? (
              <Badge ariaLabel="Unread thread">Unread</Badge>
            ) : null}
          </span>
        </span>
        <ThreadMenu
          thread={thread}
          actions={actions}
          splitAvailable={isAvailable}
          onNavigate={onNavigate}
          className="relative mr-1 shrink-0"
        />
      </div>
    </li>
  );
}

function knownIndicatorLabel(thread: PluginSidebarThread): string | null {
  switch (thread.indicator) {
    case "unread-error":
    case "waiting-for-input":
    case "working-draft":
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
    case "runtime":
    case "draft":
    case "unread-success":
      return thread.indicatorLabel ?? thread.indicator;
    case "none":
    default:
      return null;
  }
}

function ThreadMenu({
  thread,
  actions,
  splitAvailable,
  onNavigate,
  className,
}: {
  thread: PluginSidebarThread;
  actions: PluginSidebarThreadActions;
  splitAvailable: boolean;
  onNavigate: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>("[role=menuitem]")
      ?.focus();
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeForViewportChange = () => setOpen(false);
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeForViewportChange);
    window.addEventListener("scroll", closeForViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", closeForViewportChange);
      window.removeEventListener("scroll", closeForViewportChange, true);
    };
  }, [open]);

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Thread actions"
          data-bb-plugin-root=""
          data-bb-portaled-overlay=""
          style={menuPosition}
          onBlur={(event) => {
            const next = event.relatedTarget;
            if (
              !event.currentTarget.contains(next) &&
              !rootRef.current?.contains(next)
            ) {
              setOpen(false);
            }
          }}
          onKeyDown={(event) => {
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "[role=menuitem]",
              ),
            );
            const current = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              buttonRef.current?.focus();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              items[(current + 1) % items.length]?.focus();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              items[(current - 1 + items.length) % items.length]?.focus();
            } else if (event.key === "Home") {
              event.preventDefault();
              items[0]?.focus();
            } else if (event.key === "End") {
              event.preventDefault();
              items.at(-1)?.focus();
            }
          }}
          className="fixed z-50 min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {splitAvailable ? (
            <MenuItem
              onSelect={() => {
                setOpen(false);
                actions.open(thread.id, { split: true });
                onNavigate();
              }}
            >
              Open in split
            </MenuItem>
          ) : null}
          <MenuItem
            onSelect={() => {
              setOpen(false);
              void actions.setRead(thread.id, thread.isUnread);
            }}
          >
            {thread.isUnread ? "Mark read" : "Mark unread"}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              setOpen(false);
              void actions.setPinned(thread.id, !thread.isPinned);
            }}
          >
            {thread.isPinned ? "Unpin" : "Pin"}
          </MenuItem>
          <MenuItem
            onSelect={() => {
              setOpen(false);
              actions.archive(thread.id);
            }}
          >
            Archive
          </MenuItem>
          <MenuItem
            destructive
            onSelect={() => {
              setOpen(false);
              actions.requestDelete(thread.id);
            }}
          >
            Delete
          </MenuItem>
        </div>,
        document.body,
      )
    : null;

  return (
    <div ref={rootRef} className={className}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Actions for ${threadDisplayTitle(thread)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (open) {
            setOpen(false);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const width = 144;
          const estimatedHeight = 176;
          const gap = 4;
          const top =
            rect.bottom + gap + estimatedHeight <= window.innerHeight
              ? rect.bottom + gap
              : Math.max(8, rect.top - gap - estimatedHeight);
          setMenuPosition({
            left: Math.max(
              8,
              Math.min(rect.right - width, window.innerWidth - width - 8),
            ),
            top,
          });
          setOpen(true);
        }}
        className="relative flex size-7 items-center justify-center rounded text-muted-foreground opacity-70 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ···
        </span>
      </button>
      {menu}
    </div>
  );
}

function MenuItem({
  children,
  destructive = false,
  onSelect,
}: {
  children: ReactNode;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect();
      }}
      className={`block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent ${destructive ? "text-destructive-text" : ""}`}
    >
      {children}
    </button>
  );
}

function Badge({
  children,
  ariaLabel,
}: {
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className="max-w-full truncate rounded bg-muted px-1 py-px text-2xs text-muted-foreground"
    >
      {children}
    </span>
  );
}

function Glyph({ kind }: { kind: "manager" | "project" | "thread" | "pin" }) {
  if (kind === "pin") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-3 fill-current"
      >
        <path d="M5 2h6l-1 4 2 2v1H9v5L7.5 12 7 9H4V8l2-2-1-4Z" />
      </svg>
    );
  }
  if (kind === "project") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-3.5 fill-none stroke-current"
      >
        <path d="M1.5 4.5h5l1-2h3l1 2h3v8h-13v-8Z" strokeWidth="1.25" />
      </svg>
    );
  }
  if (kind === "manager") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-4 fill-none stroke-current"
      >
        <path
          d="m8 1 1.2 3.8L13 6l-3.8 1.2L8 11 6.8 7.2 3 6l3.8-1.2L8 1Z"
          strokeWidth="1.25"
        />
        <path
          d="m12.5 10 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5Z"
          strokeWidth="1"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5 fill-none stroke-current"
    >
      <path d="M2 3.5h12v8H7l-3.5 2v-2H2v-8Z" strokeWidth="1.25" />
    </svg>
  );
}
