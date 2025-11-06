require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const { getPool } = require('../src/db');
const { createAccount, getAccount, transfer } = require('../src/repo');

// Antes de todo: aplicar el schema en MySQL para tener DB y tablas listas
beforeAll(async () => {
  const raw = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    port: Number(process.env.MYSQL_PORT || 3306),
    multipleStatements: true,
  });
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await raw.query(sql);
  await raw.end();
});

// Antes de cada test: dejar la tabla limpia para ejecuciones determinísticas
beforeEach(async () => {
  const pool = await getPool();
  await pool.query('DELETE FROM accounts');
});

// Al final: cerrar el pool de MySQL
afterAll(async () => {
  const pool = await getPool();
  await pool.end();
});

// Bottom-up: probamos directamente la capa de repositorio contra MySQL real
// Sin HTTP ni KYC: validamos las reglas de saldo y la persistencia

test('Bottom-up: Repo + MySQL real (happy path transfer)', async () => {
  // Accedemos directamente al repositorio
  const aliceId = await createAccount('Alice', 1000);
  const bobId = await createAccount('Bob', 100);

  await transfer(aliceId, bobId, 250);

  const alice = await getAccount(aliceId);
  const bob = await getAccount(bobId);

  expect(Number(alice.balance)).toBe(750);
  expect(Number(bob.balance)).toBe(350);
});
