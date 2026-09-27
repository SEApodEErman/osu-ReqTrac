// Promise-based adapter over node:sqlite (DatabaseSync).
//
// The app historically used the `sqlite` wrapper on top of the native
// `sqlite3` driver. node-sqlite3 is unmaintained and drags a native build
// chain (node-gyp / prebuild-install) into every install and package.
// node:sqlite ships with Node.js >= 22.13 unflagged (and inside Electron 35+),
// so this adapter exposes the same run/get/all/exec/close surface and lets
// the entire call site network (~150 usages) stay unchanged.
//
// Compatibility details handled here:
// - params may be passed spread (`run(sql, a, b)`) or as one array
//   (`run(sql, [a, b])`), matching node-sqlite3's behavior.
// - undefined and boolean values are not bindable in node:sqlite; they are
//   coerced to NULL and 1/0 as node-sqlite3 would.
// - run() results map lastInsertRowid -> lastID (the wrapper's contract).
// - rows come back as plain objects (node:sqlite uses null-prototype objects).
const { DatabaseSync } = require('node:sqlite');

function normalizeParam(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeParams(args) {
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0].map(normalizeParam);
  }
  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === 'object' &&
    !(args[0] instanceof Uint8Array) &&
    !(args[0] instanceof Date)
  ) {
    // Named-parameters object: pass through with coerced values.
    const named = {};
    for (const [key, value] of Object.entries(args[0])) {
      named[key] = normalizeParam(value);
    }
    return [named];
  }
  return args.map(normalizeParam);
}

function wrapRow(row) {
  return row === undefined || row === null ? row : { ...row };
}

function wrapRunResult(result) {
  const lastID = typeof result.lastInsertRowid === 'bigint'
    ? Number(result.lastInsertRowid)
    : result.lastInsertRowid;
  return {
    lastID,
    lastInsertRowid: lastID,
    changes: typeof result.changes === 'bigint' ? Number(result.changes) : result.changes
  };
}

function wrapDatabase(db) {
  return {
    async run(sql, ...args) {
      return wrapRunResult(db.prepare(sql).run(...normalizeParams(args)));
    },
    async get(sql, ...args) {
      return wrapRow(db.prepare(sql).get(...normalizeParams(args)));
    },
    async all(sql, ...args) {
      return db.prepare(sql).all(...normalizeParams(args)).map(wrapRow);
    },
    async exec(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    }
  };
}

async function open({ filename } = {}) {
  return wrapDatabase(new DatabaseSync(filename));
}

module.exports = { open };
