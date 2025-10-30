require('dotenv').config();
const fs = require('fs');
const path = require('path');
const nock = require('nock');
const request = require('supertest'); // Supertest se usa llamando request(app). No hay una “instancia” global aparte.
// Cada invocación request(app) crea un cliente HTTP en memoria contra la app Express.
// Si quisieras una sesión persistente (cookies), podrías usar supertest.agent(app).
const mysql = require('mysql2/promise');
const { makeApp } = require('../src/app');
const { getPool } = require('../src/db');

// Creamos la app con una base URL de KYC “falsa”. Nock interceptará llamadas a http://fake-kyc
// Esta app es la que se pasa a Supertest: request(app).post(...).expect(...)
const app = makeApp({ kycBase: 'http://fake-kyc' });

// Antes de todo: aplicar el schema en MySQL para tener DB y tablas listas
beforeAll(async ()=>{
  const raw = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    port: Number(process.env.MYSQL_PORT || 3306),
    multipleStatements: true,
  });
  const sql = fs.readFileSync(path.join(__dirname,'..','schema.sql'),'utf8');
  await raw.query(sql);
  await raw.end();
});

// Antes de cada test: limpiar Nock y la tabla para empezar determinísticamente
beforeEach(async ()=>{
  nock.cleanAll();
  const pool = await getPool();
  await pool.query('DELETE FROM accounts');
});

// Al final: cerrar Nock y el pool de MySQL
afterAll(async ()=>{
  nock.restore();
  const pool = await getPool();
  await pool.end();
});

// Caso feliz: abrir dos cuentas (KYC aprobado), transferir y verificar balances
// Demuestra el flujo completo: HTTP → servicio → repo → MySQL, con KYC fingido
test('Sándwich: HTTP real + MySQL real + KYC fingido (happy path)', async ()=>{
  // Fijamos respuestas del KYC para dueños Alice y Bob
  nock('http://fake-kyc').get('/v1/score').query({ owner:'Alice' }).reply(200,{ score:720 });
  nock('http://fake-kyc').get('/v1/score').query({ owner:'Bob' }).reply(200,{ score:650 });

  // Crear cuentas
  const a = await request(app).post('/accounts').send({ owner:'Alice', initial:1000 }).expect(201);
  const b = await request(app).post('/accounts').send({ owner:'Bob', initial:100 }).expect(201);

  // Transferir 250 de Alice a Bob
  await request(app).post('/transfer').send({ fromId:a.body.id, toId:b.body.id, amount:250 }).expect(200);

  // Verificar balances persistidos en MySQL
  const balA = await request(app).get(`/accounts/${a.body.id}/balance`).expect(200);
  const balB = await request(app).get(`/accounts/${b.body.id}/balance`).expect(200);
  expect(balA.body.balance).toBe(750);
  expect(balB.body.balance).toBe(350);
});

