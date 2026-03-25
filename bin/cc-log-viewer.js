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

// Get positional args (not flags or flag values)
function getPositionalArgs() {
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (['--port', '--host', '--project', '--branch', '--role', '--limit'].includes(args[i])) {
        i++; // skip value
      }
      continue;
    }
    positional.push(args[i]);
  }
  return positional;
}

const { buildIndex, getStats } = require('../src/indexer.js');

function main() {
  const positional = getPositionalArgs();
  const subcommand = positional[0];

  // CLI search mode: cc-log-viewer search "query"
  if (subcommand === 'search') {
    const query = positional.slice(1).join(' ');
    if (!query) {
      console.error('Usage: cc-log-viewer search <query> [--project X] [--branch X] [--role user|assistant] [--limit N]');
      process.exit(1);
    }
    buildIndex();
    const { search } = require('../src/search.js');
    const result = search(query, {
      project: getArg('--project') || null,
      branch: getArg('--branch') || null,
      role: getArg('--role') || null,
      limit: Number(getArg('--limit')) || 20,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  // CLI sessions list: cc-log-viewer sessions
  if (subcommand === 'sessions') {
    buildIndex();
    const { listSessions } = require('../src/search.js');
    const result = listSessions({
      project: getArg('--project') || null,
      branch: getArg('--branch') || null,
      limit: Number(getArg('--limit')) || 50,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  // CLI session detail: cc-log-viewer session <id>
  if (subcommand === 'session') {
    const sessionId = positional[1];
    if (!sessionId) {
      console.error('Usage: cc-log-viewer session <session-id>');
      process.exit(1);
    }
    buildIndex();
    const { getSession } = require('../src/search.js');
    const data = getSession(sessionId);
    if (!data) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  }

  // Existing flags
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

  // Default: start web server
  const port = Number(getArg('--port')) || 8899;
  const host = getArg('--host') || '127.0.0.1';

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
