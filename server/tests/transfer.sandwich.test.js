require('dotenv').config();
const fs = require('fs');
const path = require('path');
const nock = require('nock');
const request = require('supertest');
const mysql = require('mysql2/promise');
const { makeApp } = require('../src/app');
const { getPool } = require('../src/db');

// Creamos la app con una base URL de KYC “falsa”. Nock interceptará llamadas a http://fake-kyc
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

// Caso negativo: fondos insuficientes debe devolver 409 con el error adecuado
test('Fondos insuficientes → 409', async ()=>{
  // Ambos dueños pasan KYC
  nock('http://fake-kyc').get('/v1/score').query({ owner:'A' }).reply(200,{ score:800 });
  nock('http://fake-kyc').get('/v1/score').query({ owner:'B' }).reply(200,{ score:800 });

  const A = (await request(app).post('/accounts').send({ owner:'A', initial:10 })).body.id;
  const B = (await request(app).post('/accounts').send({ owner:'B', initial:0 })).body.id;

  // Intentar transferir más de lo que A tiene
  const r = await request(app).post('/transfer').send({ fromId:A, toId:B, amount:50 });
  expect(r.status).toBe(409);
  expect(r.body.error).toBe('insufficient_funds');
});

// Caso negativo: KYC rechazado al abrir cuenta → 403 kyc_rejected
// Si el score < 500 debe fallar y NO crear la cuenta
test('KYC rechazado en apertura de cuenta → 403', async ()=>{
  nock('http://fake-kyc').get('/v1/score').query({ owner:'Charlie' }).reply(200,{ score:450 });

  const r = await request(app).post('/accounts').send({ owner:'Charlie', initial:100 });
  expect(r.status).toBe(403);
  expect(r.body.error).toBe('kyc_rejected');
});

// Caso negativo: monto inválido (0 o negativo) en transferencia → 400 invalid_amount
// La regla de negocio no permite transferir 0 o valores negativos
test('Monto inválido (0) en transferencia → 400', async ()=>{
  // Crear dos cuentas válidas (KYC aprobado)
  nock('http://fake-kyc').get('/v1/score').query({ owner:'D' }).reply(200,{ score:700 });
  nock('http://fake-kyc').get('/v1/score').query({ owner:'E' }).reply(200,{ score:700 });
  const D = (await request(app).post('/accounts').send({ owner:'D', initial:100 })).body.id;
  const E = (await request(app).post('/accounts').send({ owner:'E', initial:100 })).body.id;

  const r = await request(app).post('/transfer').send({ fromId:D, toId:E, amount:0 });
  expect(r.status).toBe(400);
  expect(r.body.error).toBe('invalid_amount');
});

test('Monto inválido (negativo) en transferencia → 400', async ()=>{
  nock('http://fake-kyc').get('/v1/score').query({ owner:'F' }).reply(200,{ score:700 });
  nock('http://fake-kyc').get('/v1/score').query({ owner:'G' }).reply(200,{ score:700 });
  const F = (await request(app).post('/accounts').send({ owner:'F', initial:100 })).body.id;
  const G = (await request(app).post('/accounts').send({ owner:'G', initial:100 })).body.id;

  const r = await request(app).post('/transfer').send({ fromId:F, toId:G, amount:-10 });
  expect(r.status).toBe(400);
  expect(r.body.error).toBe('invalid_amount');
});

// Caso negativo: transferir hacia una cuenta inexistente → 404 account_not_found
test('Transfer a cuenta inexistente → 404', async ()=>{
  nock('http://fake-kyc').get('/v1/score').query({ owner:'H' }).reply(200,{ score:700 });
  const H = (await request(app).post('/accounts').send({ owner:'H', initial:100 })).body.id;
  const inexistente = 999999; // ID que no existe

  const r = await request(app).post('/transfer').send({ fromId:H, toId:inexistente, amount:10 });
  expect(r.status).toBe(404);
  expect(r.body.error).toBe('account_not_found');
});

// Caso negativo: consultar balance de cuenta inexistente → 404 account_not_found
test('GET /accounts/:id/balance de cuenta inexistente → 404', async ()=>{
  const inexistente = 424242;
  const r = await request(app).get(`/accounts/${inexistente}/balance`);
  expect(r.status).toBe(404);
  expect(r.body.error).toBe('account_not_found');
});
