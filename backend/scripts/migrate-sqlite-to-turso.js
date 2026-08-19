#!/usr/bin/env node

/**
 * Copy the local SQLite database into the configured Turso/libSQL database.
 * Run with:
 *   LIBSQL_URL=libsql://... LIBSQL_AUTH_TOKEN=... node scripts/migrate-sqlite-to-turso.js
 */
const path = require('path');
const fs = require('fs');
const LocalDatabase = require('better-sqlite3');
const RemoteDatabase = require('libsql');

if (!process.env.LIBSQL_URL || !process.env.LIBSQL_AUTH_TOKEN) {
  throw new Error('LIBSQL_URL and LIBSQL_AUTH_TOKEN are required.');
}

const localPath = process.env.SQLITE_SOURCE_PATH || path.join(__dirname, '..', 'data', 'educore.sqlite');
if (!fs.existsSync(localPath)) {
  throw new Error(`SQLite source database not found: ${localPath}`);
}

const source = new LocalDatabase(localPath, { readonly: true });
const target = new RemoteDatabase(process.env.LIBSQL_URL, {
  authToken: process.env.LIBSQL_AUTH_TOKEN,
});

// Requiring the application database layer initializes the complete schema and indexes.
require('../src/db');

const tables = source.prepare(`
  SELECT name FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all().map((row) => row.name);

let copied = 0;
for (const table of tables) {
  const columns = source.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.length) continue;

  const quotedColumns = columns.map((column) => `"${column.replaceAll('"', '""')}"`).join(', ');
  const placeholders = columns.map(() => '?').join(', ');
  const insert = target.prepare(`INSERT OR REPLACE INTO "${table.replaceAll('"', '""')}" (${quotedColumns}) VALUES (${placeholders})`);

  for (const row of source.prepare(`SELECT ${quotedColumns} FROM "${table.replaceAll('"', '""')}"`).iterate()) {
    insert.run(...columns.map((column) => row[column]));
    copied += 1;
  }
}

console.log(`Copied ${copied} rows from ${localPath} to ${process.env.LIBSQL_URL}`);
source.close();
