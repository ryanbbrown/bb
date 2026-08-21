type EnvironmentHostMode = "local" | "worktree";

interface ParsedHostEnvironmentValue {
  type: "host";
  hostId: string;
  mode: EnvironmentHostMode;
}

interface ParsedReuseEnvironmentValue {
  type: "reuse";
  /** Null when the user has picked Reuse mode but hasn't chosen a specific
   * worktree yet. Submit is gated on a non-null id by the resolver. */
  environmentId: string | null;
}

export interface ParsedWorktreePathEnvironmentValue {
  type: "worktree-path";
  hostId: string;
  path: string;
}

/** Bare reuse value — env mode set, specific worktree not chosen yet. */
export const REUSE_VALUE_WITHOUT_ENVIRONMENT = "reuse";

export type ParsedEnvironmentValue =
  | ParsedHostEnvironmentValue
  | ParsedReuseEnvironmentValue
  | ParsedWorktreePathEnvironmentValue
  | null;

export function encodeHostValue(
  hostId: string,
  mode: EnvironmentHostMode,
): string {
  return `host:${hostId}:${mode}`;
}

export function encodeReuseValue(environmentId: string): string {
  return `reuse:${environmentId}`;
}

export function encodeWorktreePathValue(hostId: string, path: string): string {
  return `worktree-path:${encodeURIComponent(hostId)}:${encodeURIComponent(path)}`;
}

export function parseEnvironmentValue(value: string): ParsedEnvironmentValue {
  if (value === REUSE_VALUE_WITHOUT_ENVIRONMENT) {
    return { type: "reuse", environmentId: null };
  }
  if (value.startsWith("host:")) {
    const parts = value.split(":");
    const hostId = parts[1];
    const mode = parts[2];
    if (hostId && (mode === "local" || mode === "worktree")) {
      return { type: "host", hostId, mode };
    }
  }
  if (value.startsWith("reuse:")) {
    const environmentId = value.slice("reuse:".length);
    if (environmentId.length > 0) {
      return { type: "reuse", environmentId };
    }
  }
  if (value.startsWith("worktree-path:")) {
    const separator = value.indexOf(":", "worktree-path:".length);
    if (separator > 0) {
      try {
        const hostId = decodeURIComponent(
          value.slice("worktree-path:".length, separator),
        );
        const path = decodeURIComponent(value.slice(separator + 1));
        if (hostId.length > 0 && path.length > 0) {
          return { type: "worktree-path", hostId, path };
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}
