const fs = require('node:fs');
const path = require('node:path');

const { db } = require('./client');

function initDatabase() {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
}

module.exports = { initDatabase };

