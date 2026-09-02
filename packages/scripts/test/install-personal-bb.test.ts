import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..", "..");
const installerSource = join(repoRoot, "scripts", "install-personal-bb");
const fixtureRoots: string[] = [];

interface InstallerFixture {
  dependencyMarker: string;
  home: string;
  invocationLog: string;
  repo: string;
  sideEffectLog: string;
  stubBin: string;
}

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function createFixture(options: {
  dependenciesReady: boolean;
}): InstallerFixture {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "install-personal-bb-test-")),
  );
  fixtureRoots.push(root);

  const repo = join(root, "repo");
  const home = join(root, "home");
  const stubBin = join(root, "bin");
  const state = join(root, "state");
  const dependencyMarker = join(state, "dependencies-ready");
  const invocationLog = join(state, "invocations.log");
  const sideEffectLog = join(state, "side-effects.log");

  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(home, ".bb"), { recursive: true });
  mkdirSync(stubBin, { recursive: true });
  mkdirSync(state, { recursive: true });
  copyFileSync(installerSource, join(repo, "scripts", "install-personal-bb"));
  chmodSync(join(repo, "scripts", "install-personal-bb"), 0o755);
  writeFileSync(join(home, ".bb", "bb.db"), "fixture database");
  writeFileSync(invocationLog, "");
  writeFileSync(sideEffectLog, "");
  if (options.dependenciesReady) {
    writeFileSync(dependencyMarker, "ready");
  }

  writeExecutable(
    join(stubBin, "uname"),
    `#!/usr/bin/env bash
case "\${1:-}" in
  -s) printf '%s\\n' Darwin ;;
  -m) printf '%s\\n' arm64 ;;
  *) exit 64 ;;
esac
`,
  );
  writeExecutable(
    join(stubBin, "git"),
    `#!/usr/bin/env bash
if [ "\${3:-}" = "branch" ] && [ "\${4:-}" = "--show-current" ]; then
  printf '%s\\n' personal
  exit 0
fi
exit 65
`,
  );
  writeExecutable(
    join(stubBin, "pnpm"),
    `#!/usr/bin/env bash
printf 'cwd=%s pnpm' "$PWD" >> "$INSTALL_TEST_INVOCATIONS"
printf ' %q' "$@" >> "$INSTALL_TEST_INVOCATIONS"
printf '\\n' >> "$INSTALL_TEST_INVOCATIONS"
if [ "$PWD" = "$INSTALL_TEST_REPO" ] && [ "$*" = "install --frozen-lockfile --prefer-offline" ]; then
  if [ "\${INSTALL_TEST_INSTALL_STATUS:-0}" -ne 0 ]; then
    exit "$INSTALL_TEST_INSTALL_STATUS"
  fi
  printf '%s\\n' ready > "$INSTALL_TEST_DEPENDENCY_MARKER"
  exit 0
fi
if [ "$*" = "exec turbo run build --filter=@bb/desktop" ]; then
  [ -f "$INSTALL_TEST_DEPENDENCY_MARKER" ] || exit 44
  exit 0
fi
exit 66
`,
  );
  writeExecutable(
    join(stubBin, "node"),
    `#!/usr/bin/env bash
printf 'node' >> "$INSTALL_TEST_INVOCATIONS"
printf ' %q' "$@" >> "$INSTALL_TEST_INVOCATIONS"
printf '\\n' >> "$INSTALL_TEST_INVOCATIONS"
exit 77
`,
  );

  for (const command of [
    "curl",
    "ditto",
    "open",
    "osascript",
    "pgrep",
    "pkill",
  ]) {
    writeExecutable(
      join(stubBin, command),
      `#!/usr/bin/env bash
printf '%s\\n' "${command} $*" >> "$INSTALL_TEST_SIDE_EFFECTS"
exit 78
`,
    );
  }

  return {
    dependencyMarker,
    home,
    invocationLog,
    repo,
    sideEffectLog,
    stubBin,
  };
}

function runInstaller(
  fixture: InstallerFixture,
  options: { installStatus?: number } = {},
) {
  return spawnSync(join(fixture.repo, "scripts", "install-personal-bb"), {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: fixture.home,
      INSTALL_TEST_DEPENDENCY_MARKER: fixture.dependencyMarker,
      INSTALL_TEST_INSTALL_STATUS: String(options.installStatus ?? 0),
      INSTALL_TEST_INVOCATIONS: fixture.invocationLog,
      INSTALL_TEST_REPO: fixture.repo,
      INSTALL_TEST_SIDE_EFFECTS: fixture.sideEffectLog,
      PATH: `${fixture.stubBin}:/usr/bin:/bin`,
    },
  });
}

function logLines(path: string): string[] {
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("personal BB installer dependency preparation", () => {
  it("reconciles missing workspace dependencies before the build", () => {
    const fixture = createFixture({ dependenciesReady: false });

    const result = runInstaller(fixture);

    expect(
      result.status,
      `invocations:\n${readFileSync(fixture.invocationLog, "utf8")}stderr:\n${result.stderr}`,
    ).toBe(77);
    expect(existsSync(fixture.dependencyMarker)).toBe(true);
    expect(logLines(fixture.invocationLog)).toEqual([
      `cwd=${fixture.repo} pnpm install --frozen-lockfile --prefer-offline`,
      `cwd=${fixture.repo} pnpm exec turbo run build --filter=@bb/desktop`,
      "node apps/desktop/scripts/run-electron-builder.mjs --mac --dir --arm64",
    ]);
    expect(readFileSync(fixture.sideEffectLog, "utf8")).toBe("");
  });

  it("stops before build or live state access when dependency preparation fails", () => {
    const fixture = createFixture({ dependenciesReady: false });

    const result = runInstaller(fixture, { installStatus: 23 });

    expect(result.status).toBe(23);
    expect(existsSync(fixture.dependencyMarker)).toBe(false);
    expect(logLines(fixture.invocationLog)).toEqual([
      `cwd=${fixture.repo} pnpm install --frozen-lockfile --prefer-offline`,
    ]);
    expect(readFileSync(fixture.sideEffectLog, "utf8")).toBe("");
  });

  it("checks an already-current workspace and continues without special handling", () => {
    const fixture = createFixture({ dependenciesReady: true });

    const result = runInstaller(fixture);

    expect(result.status).toBe(77);
    expect(logLines(fixture.invocationLog)).toEqual([
      `cwd=${fixture.repo} pnpm install --frozen-lockfile --prefer-offline`,
      `cwd=${fixture.repo} pnpm exec turbo run build --filter=@bb/desktop`,
      "node apps/desktop/scripts/run-electron-builder.mjs --mac --dir --arm64",
    ]);
    expect(readFileSync(fixture.sideEffectLog, "utf8")).toBe("");
  });
});
