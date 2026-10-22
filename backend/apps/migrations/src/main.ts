import 'reflect-metadata';
import { MigrationExecutor } from 'typeorm';
import source from '../../../libs/database/src/data-source';

async function migrate(): Promise<void> {
  await source.initialize();
  const runner = source.createQueryRunner();
  try {
    // MySQL DDL is not transactional. Serialize migration runners, and require
    // manual inspection of partially applied DDL instead of an automatic reset.
    await runner.connect();
    const rows = await runner.query(
      "SELECT GET_LOCK('matjary:migrations', 60) AS acquired",
    );
    if (Number(rows[0]?.acquired) !== 1)
      throw new Error('Migration lock unavailable');
    // Reuse the lock-holding connection, including when the pool size is one.
    const migrations = new MigrationExecutor(source, runner);
    migrations.transaction = 'none';
    await migrations.executePendingMigrations();
    console.log('Migrations completed');
  } finally {
    await runner
      .query("SELECT RELEASE_LOCK('matjary:migrations')")
      .catch(() => undefined);
    await runner.release();
    await source.destroy();
  }
}

migrate().catch(() => {
  console.error(
    'Migration failed. Inspect schema_migrations and database DDL before retrying.',
  );
  process.exitCode = 1;
});
