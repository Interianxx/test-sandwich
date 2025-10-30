require('dotenv').config();
const fs = require('fs');
const path = require('path');
const nock = require('nock');
const request = require('supertest');
const mysql = require('mysql2/promise');
const { makeApp } = require('../src/app');
const { getPool } = require('../src/db');

const app = makeApp({ kycBase: 'http://fake-kyc' });

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

beforeEach(async ()=>{
  nock.cleanAll();
  const pool = await getPool();
  await pool.query('DELETE FROM accounts');
});

afterAll(async ()=>{
  nock.restore();
  const pool = await getPool();
  await pool.end();
});

test('Sándwich: HTTP real + MySQL real + KYC fingido', async ()=>{
  nock('http://fake-kyc').get('/v1/score').query({ owner:'Alice' }).reply(200,{ score:720 });
  nock('http://fake-kyc').get('/v1/score').query({ owner:'Bob' }).reply(200,{ score:650 });

  const a = await request(app).post('/accounts').send({ owner:'Alice', initial:1000 }).expect(201);
  const b = await request(app).post('/accounts').send({ owner:'Bob', initial:100 }).expect(201);

  await request(app).post('/transfer').send({ fromId:a.body.id, toId:b.body.id, amount:250 }).expect(200);

  const balA = await request(app).get(`/accounts/${a.body.id}/balance`).expect(200);
  const balB = await request(app).get(`/accounts/${b.body.id}/balance`).expect(200);
  expect(balA.body.balance).toBe(750);
  expect(balB.body.balance).toBe(350);
});

test('Fondos insuficientes → 409', async ()=>{
  nock('http://fake-kyc').get('/v1/score').query({ owner:'A' }).reply(200,{ score:800 });
  nock('http://fake-kyc').get('/v1/score').query({ owner:'B' }).reply(200,{ score:800 });

  const A = (await request(app).post('/accounts').send({ owner:'A', initial:10 })).body.id;
  const B = (await request(app).post('/accounts').send({ owner:'B', initial:0 })).body.id;

  const r = await request(app).post('/transfer').send({ fromId:A, toId:B, amount:50 });
  expect(r.status).toBe(409);
  expect(r.body.error).toBe('insufficient_funds');
});
