import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyAndReconcilePersonalDatabase,
  reconcilePersonalMigrationHistory,
} from "../scripts/personal-install-db.js";

const tempDirs: string[] = [];

interface AppliedMigrationRow {
  createdAt: number;
  hash: string;
}

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "bb-personal-install-db-"),
  );
  tempDirs.push(tempDir);
  return tempDir;
}

function writeMigrations(
  migrationsFolder: string,
  migrations: ReadonlyArray<{ sql: string; tag: string; when: number }>,
): void {
  fs.mkdirSync(path.join(migrationsFolder, "meta"), { recursive: true });
  fs.writeFileSync(
    path.join(migrationsFolder, "meta", "_journal.json"),
    JSON.stringify({
      entries: migrations.map((migration, idx) => ({
        breakpoints: true,
        idx,
        tag: migration.tag,
        version: "6",
        when: migration.when,
      })),
    }),
  );

  for (const migration of migrations) {
    fs.writeFileSync(
      path.join(migrationsFolder, `${migration.tag}.sql`),
      `${migration.sql}\n`,
    );
  }
}

function createHistoricalPersonalDatabase(
  databasePath: string,
  personalHash: string,
  staleTimestamps: readonly number[] = [150],
): void {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE app_settings (
      id integer PRIMARY KEY,
      show_sidebar_thread_numbers integer DEFAULT false NOT NULL
    );
    CREATE TABLE __drizzle_migrations (
      id integer PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    );
  `);
  const insert = database.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );
  for (const timestamp of staleTimestamps) {
    insert.run(personalHash, timestamp);
  }
  database.close();
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

describe("personal install database reconciliation", () => {
  it("applies M93 and aliases relocated P94 without rerunning its SQL", () => {
    const tempDir = createTempDir();
    const migrationsFolder = path.join(tempDir, "drizzle");
    const databasePath = path.join(tempDir, "bb.db");
    writeMigrations(migrationsFolder, [
      {
        tag: "0093_main",
        when: 200,
        sql: "ALTER TABLE app_settings ADD COLUMN main_setting integer DEFAULT false NOT NULL;",
      },
      {
        tag: "0094_personal",
        when: 300,
        sql: "ALTER TABLE app_settings ADD COLUMN show_sidebar_thread_numbers integer DEFAULT false NOT NULL;",
      },
    ]);
    const migrations = readMigrationFiles({ migrationsFolder });
    createHistoricalPersonalDatabase(databasePath, migrations[1].hash);

    const database = new Database(databasePath);
    reconcilePersonalMigrationHistory(database, migrationsFolder);

    const columns = database
      .prepare("PRAGMA table_info(app_settings)")
      .all()
      .map((row) => (row as { name: string }).name);
    const applied = database
      .prepare(
        "SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at",
      )
      .all() as AppliedMigrationRow[];
    database.close();

    expect(columns).toEqual([
      "id",
      "show_sidebar_thread_numbers",
      "main_setting",
    ]);
    expect(applied).toEqual([
      { createdAt: 200, hash: migrations[0].hash },
      { createdAt: 300, hash: migrations[1].hash },
    ]);
  });

  it("collapses stale rows left by an earlier relocation", () => {
    const tempDir = createTempDir();
    const migrationsFolder = path.join(tempDir, "drizzle");
    const databasePath = path.join(tempDir, "bb.db");
    writeMigrations(migrationsFolder, [
      {
        tag: "0093_main",
        when: 200,
        sql: "ALTER TABLE app_settings ADD COLUMN main_setting integer DEFAULT false NOT NULL;",
      },
      {
        tag: "0094_personal",
        when: 300,
        sql: "ALTER TABLE app_settings ADD COLUMN show_sidebar_thread_numbers integer DEFAULT false NOT NULL;",
      },
    ]);
    const migrations = readMigrationFiles({ migrationsFolder });
    createHistoricalPersonalDatabase(databasePath, migrations[1].hash, [
      150, 175,
    ]);

    const database = new Database(databasePath);
    const result = reconcilePersonalMigrationHistory(
      database,
      migrationsFolder,
    );
    const applied = database
      .prepare(
        "SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at",
      )
      .all() as AppliedMigrationRow[];
    database.close();

    expect(result.relocated).toEqual(["0094_personal"]);
    expect(applied).toEqual([
      { createdAt: 200, hash: migrations[0].hash },
      { createdAt: 300, hash: migrations[1].hash },
    ]);
  });

  it("rejects an ambiguous historical hash without changing the database", () => {
    const tempDir = createTempDir();
    const migrationsFolder = path.join(tempDir, "drizzle");
    const databasePath = path.join(tempDir, "bb.db");
    const personalSql =
      "ALTER TABLE app_settings ADD COLUMN show_sidebar_thread_numbers integer DEFAULT false NOT NULL;";
    writeMigrations(migrationsFolder, [
      { tag: "0093_personal_copy", when: 200, sql: personalSql },
      { tag: "0094_personal", when: 300, sql: personalSql },
    ]);
    const migrations = readMigrationFiles({ migrationsFolder });
    createHistoricalPersonalDatabase(databasePath, migrations[0].hash);

    const database = new Database(databasePath);
    expect(() =>
      reconcilePersonalMigrationHistory(database, migrationsFolder),
    ).toThrow("Ambiguous migration hash");
    const applied = database
      .prepare("SELECT hash, created_at FROM __drizzle_migrations")
      .all();
    database.close();

    expect(applied).toEqual([{ created_at: 150, hash: migrations[0].hash }]);
  });

  it("discards a failed migrated copy and leaves the source unchanged", async () => {
    const tempDir = createTempDir();
    const migrationsFolder = path.join(tempDir, "drizzle");
    const sourcePath = path.join(tempDir, "source.db");
    const copyPath = path.join(tempDir, "copy.db");
    writeMigrations(migrationsFolder, [
      {
        tag: "0093_broken",
        when: 200,
        sql: "ALTER TABLE missing_table ADD COLUMN setting integer;",
      },
    ]);
    const source = new Database(sourcePath);
    source.exec(`
      CREATE TABLE app_settings (id integer PRIMARY KEY);
      CREATE TABLE __drizzle_migrations (
        id integer PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      );
      INSERT INTO app_settings (id) VALUES (1);
    `);
    source.close();
    const sourceBefore = fs.readFileSync(sourcePath);

    await expect(
      copyAndReconcilePersonalDatabase({
        destinationPath: copyPath,
        migrationsFolder,
        sourcePath,
      }),
    ).rejects.toThrow("no such table: missing_table");

    expect(fs.readFileSync(sourcePath)).toEqual(sourceBefore);
    expect(fs.existsSync(copyPath)).toBe(false);
  });
});
