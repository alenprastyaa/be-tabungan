const { Pool, types } = require("pg");
require("dotenv").config();

// Keep PostgreSQL DATE values as plain strings to avoid timezone shifts
// when JavaScript serializes them back to JSON.
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
});

module.exports = pool;
