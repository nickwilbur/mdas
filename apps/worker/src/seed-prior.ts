// Previously seeded a synthetic "prior" snapshot from mock fixtures so WoW
// diffs were non-empty during demos. Mock data has been retired in favor of
// real Glean/Salesforce ingestion, so this is now a no-op kept only so the
// `npm run seed` script (scripts/seed.mjs) doesn't fail.
console.log('[seed-prior] no-op — mock fixtures retired; use real-data import');
process.exit(0);
