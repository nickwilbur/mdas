#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL || 'postgres://mdas:mdas@localhost:5432/mdas';
const client = new pg.Client({ connectionString: url });
await client.connect();

const dir = join(process.cwd(), 'packages/db/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  console.log(`[migrate] applying ${f}`);
  const sql = readFileSync(join(dir, f), 'utf8');
  await client.query(sql);
}
console.log('[migrate] done');
await client.end();
