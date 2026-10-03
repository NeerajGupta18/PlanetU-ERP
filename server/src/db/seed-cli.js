import { runMigrations } from './migrate.js';
import { seedDemoTenants } from './seed.js';
import { closePool } from './pool.js';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Refusing to run: this creates demo institutes and a vendor login (SA001) with PUBLISHED passwords.\n'
    + 'On a real server use `npm run db:migrate` and then `npm run create-vendor`.\n'
    + '(To seed a throw-away staging copy anyway, set ALLOW_DEMO_SEED=true.)');
  process.exit(1);
}

try {
  await runMigrations();
  await seedDemoTenants();
  console.log('Demo tenants re-created. Sign in with an institute code + demo account: see README.md');
} finally {
  await closePool();
}
