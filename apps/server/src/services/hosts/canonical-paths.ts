import type { WorkSessionDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "./online-rpc.js";

const RESOLVE_PATHS_BATCH_SIZE = 512;

export async function resolveCanonicalHostPaths(
  deps: WorkSessionDeps,
  args: { hostId: string; paths: readonly string[] },
): Promise<Map<string, string | null>> {
  const uniquePaths = [...new Set(args.paths)];
  const resolved = new Map<string, string | null>();
  for (
    let offset = 0;
    offset < uniquePaths.length;
    offset += RESOLVE_PATHS_BATCH_SIZE
  ) {
    const paths = uniquePaths.slice(offset, offset + RESOLVE_PATHS_BATCH_SIZE);
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: { type: "host.resolve_paths", paths },
    });
    for (const entry of result.paths) {
      resolved.set(entry.path, entry.canonicalPath);
    }
  }
  return resolved;
}
