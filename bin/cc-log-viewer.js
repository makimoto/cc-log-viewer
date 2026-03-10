#!/usr/bin/env node

'use strict';

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name) {
  return args.includes(name);
}

const port = Number(getArg('--port')) || 8899;
const host = getArg('--host') || '127.0.0.1';

const { buildIndex, getStats } = require('../src/indexer.js');

function main() {
  if (hasFlag('--stats')) {
    const stats = getStats();
    for (const [key, value] of Object.entries(stats)) {
      console.log(`${key}: ${value}`);
    }
    process.exit(0);
  }

  if (hasFlag('--reindex') || hasFlag('--reindex-force')) {
    const force = hasFlag('--reindex-force');
    console.log(force ? 'Force reindexing...' : 'Reindexing...');
    const result = buildIndex(force);
    console.log(`Indexed ${result.sessionsIndexed} sessions, skipped ${result.sessionsSkipped}`);
    process.exit(0);
  }

  console.log('Building index...');
  const result = buildIndex();
  console.log(`Indexed ${result.sessionsIndexed} sessions, skipped ${result.sessionsSkipped}`);

  const { start } = require('../src/server.js');
  start(host, port);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
