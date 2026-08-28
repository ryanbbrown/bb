import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "../src/connection.js";
import { migrate } from "../src/migrate.js";

interface MigrationJournalEntry {
  tag: string;
  when: number;
}

interface ExpectedMigration extends MigrationJournalEntry {
  hash: string;
  sql: string[];
}

interface AppliedMigrationRow {
  createdAt: number | null;
  hash: string;
}

export interface PersonalMigrationReconciliationResult {
  applied: string[];
  relocated: string[];
}

export interface CopyAndReconcilePersonalDatabaseArgs {
  destinationPath: string;
  migrationsFolder: string;
  sourcePath: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJournalEntry(value: unknown): MigrationJournalEntry {
  if (!isObject(value)) {
    throw new Error("Unexpected migration journal entry shape");
  }
  if (typeof value.tag !== "string" || typeof value.when !== "number") {
    throw new Error("Unexpected migration journal entry fields");
  }
  return { tag: value.tag, when: value.when };
}

function readExpectedMigrations(migrationsFolder: string): ExpectedMigration[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journalValue: unknown = JSON.parse(
    fs.readFileSync(journalPath, "utf8"),
  );
  if (!isObject(journalValue) || !Array.isArray(journalValue.entries)) {
    throw new Error("Unexpected migration journal shape");
  }

  const journal = journalValue.entries.map(parseJournalEntry);
  const migrationFiles = readMigrationFiles({ migrationsFolder });
  if (journal.length !== migrationFiles.length) {
    throw new Error(
      `Migration journal length mismatch: ${journal.length} entries and ${migrationFiles.length} files`,
    );
  }

  return journal.map((entry, index) => {
    const migration = migrationFiles[index];
    if (migration.folderMillis !== entry.when) {
      throw new Error(
        `Migration timestamp mismatch for ${entry.tag}: journal=${entry.when}, file=${migration.folderMillis}`,
      );
    }
    return {
      hash: migration.hash,
      sql: migration.sql,
      tag: entry.tag,
      when: entry.when,
    };
  });
}

function readAppliedMigrations(
  database: Database.Database,
): AppliedMigrationRow[] | null {
  const table = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();
  if (table === undefined) {
    return null;
  }
  return database
    .prepare("SELECT hash, created_at AS createdAt FROM __drizzle_migrations")
    .all() as AppliedMigrationRow[];
}

function insertAppliedMigration(
  database: Database.Database,
  migration: ExpectedMigration,
): void {
  database
    .prepare(
      "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    )
    .run(migration.hash, migration.when);
}

function relocateAppliedMigration(
  database: Database.Database,
  migration: ExpectedMigration,
): void {
  database
    .prepare("DELETE FROM __drizzle_migrations WHERE hash = ?")
    .run(migration.hash);
  insertAppliedMigration(database, migration);
}

export function reconcilePersonalMigrationHistory(
  database: Database.Database,
  migrationsFolder: string,
): PersonalMigrationReconciliationResult {
  const expected = readExpectedMigrations(migrationsFolder);
  const existing = readAppliedMigrations(database);
  if (existing === null) {
    return { applied: [], relocated: [] };
  }

  const expectedHashCounts = new Map<string, number>();
  for (const migration of expected) {
    expectedHashCounts.set(
      migration.hash,
      (expectedHashCounts.get(migration.hash) ?? 0) + 1,
    );
  }
  const expectedTimestamps = new Set(
    expected.map((migration) => migration.when),
  );

  const reconcile = database.transaction(() => {
    let applied = [...existing];
    const result: PersonalMigrationReconciliationResult = {
      applied: [],
      relocated: [],
    };

    for (const migration of expected) {
      const timestampRows = applied.filter(
        (row) => row.createdAt === migration.when,
      );
      if (timestampRows.length > 0) {
        continue;
      }

      const hashRows = applied.filter((row) => row.hash === migration.hash);
      if (hashRows.length > 0) {
        const expectedHashCount = expectedHashCounts.get(migration.hash) ?? 0;
        const staleRows = hashRows.filter(
          (row) =>
            row.createdAt === null || !expectedTimestamps.has(row.createdAt),
        );
        if (expectedHashCount !== 1 || staleRows.length !== hashRows.length) {
          throw new Error(
            `Ambiguous migration hash for ${migration.tag}: ${migration.hash}`,
          );
        }
        relocateAppliedMigration(database, migration);
        applied = applied.filter((row) => row.hash !== migration.hash);
        applied.push({ createdAt: migration.when, hash: migration.hash });
        result.relocated.push(migration.tag);
        continue;
      }

      for (const statement of migration.sql) {
        database.exec(statement);
      }
      insertAppliedMigration(database, migration);
      applied.push({ createdAt: migration.when, hash: migration.hash });
      result.applied.push(migration.tag);
    }

    return result;
  });

  return reconcile();
}

function removeDatabaseFiles(databasePath: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

export async function copyAndReconcilePersonalDatabase(
  args: CopyAndReconcilePersonalDatabaseArgs,
): Promise<PersonalMigrationReconciliationResult> {
  if (fs.existsSync(args.destinationPath)) {
    throw new Error(`Database copy already exists: ${args.destinationPath}`);
  }

  const source = new Database(args.sourcePath, {
    fileMustExist: true,
    readonly: true,
  });
  try {
    await source.backup(args.destinationPath);
  } finally {
    source.close();
  }

  let copy: Database.Database | null = null;
  try {
    fs.chmodSync(args.destinationPath, 0o600);
    copy = new Database(args.destinationPath);
    const result = reconcilePersonalMigrationHistory(
      copy,
      args.migrationsFolder,
    );
    copy.pragma("wal_checkpoint(TRUNCATE)");
    copy.close();
    copy = null;
    return result;
  } catch (error) {
    copy?.close();
    removeDatabaseFiles(args.destinationPath);
    throw error;
  }
}

async function prepareValidatedPersonalDatabaseCopy(
  args: CopyAndReconcilePersonalDatabaseArgs,
): Promise<PersonalMigrationReconciliationResult> {
  try {
    const result = await copyAndReconcilePersonalDatabase(args);
    const database = createConnection(args.destinationPath);
    try {
      migrate(database);
      database.$client.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      database.$client.close();
    }
    return result;
  } catch (error) {
    removeDatabaseFiles(args.destinationPath);
    throw error;
  }
}

async function main(): Promise<void> {
  const [sourcePath, destinationPath, migrationsFolder] = process.argv.slice(2);
  if (
    sourcePath === undefined ||
    destinationPath === undefined ||
    migrationsFolder === undefined ||
    process.argv.length !== 5
  ) {
    throw new Error(
      "Usage: personal-install-db.ts <source-db> <destination-db> <migrations-folder>",
    );
  }

  const result = await prepareValidatedPersonalDatabaseCopy({
    destinationPath,
    migrationsFolder,
    sourcePath,
  });
  process.stdout.write(
    `Applied ${result.applied.length} migration(s); reconciled ${result.relocated.length} relocation(s).\n`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
