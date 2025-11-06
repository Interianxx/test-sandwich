
const nock = require('nock');

// Mock del repositorio: persistencia en memoria (sin MySQL)
jest.mock('../src/repo', () => {
  const state = { seq: 1, mem: [] };
  return {
    __reset: () => { state.seq = 1; state.mem = []; },
    createAccount: async (owner, balance = 0) => {
      const id = state.seq++;
      state.mem.push({ id, owner, balance: Number(balance) });
      return id;
    },
    getAccount: async (id) => state.mem.find(a => a.id === Number(id)) || null,
    transfer: async (fromId, toId, amount) => {
      const a = state.mem.find(x => x.id === Number(fromId));
      const b = state.mem.find(x => x.id === Number(toId));
      if (!a || !b) throw new Error('account_not_found');
      if (Number(a.balance) < Number(amount)) throw new Error('insufficient_funds');
      a.balance = Number(a.balance) - Number(amount);
      b.balance = Number(b.balance) + Number(amount);
    }
  };
});

// Importar app DESPUÉS del mock para que use el repo en memoria
const request = require('supertest');
const { makeApp } = require('../src/app');
const app = makeApp({ kycBase: 'http://fake-kyc' });

// Acceso al mock para resetear entre tests
const repo = require('../src/repo');

beforeEach(() => {
  nock.cleanAll();
  if (typeof repo.__reset === 'function') repo.__reset();
});

afterEach(() => {
  // Asegura que se consumieron todos los stubs de KYC
  if (!nock.isDone()) {
    const pending = nock.pendingMocks();
    nock.cleanAll();
    throw new Error(`KYC mocks no consumidos: ${pending.join(', ')}`);
  }
});

afterAll(() => {
  nock.restore();
});

// Top-down puro: HTTP -> Express/Servicio (repo en memoria) + KYC simulado
test('Fondos insuficientes → 409 (top-down puro, repo en memoria)', async () => {
  // Supertest hace una peticion HTTP a la api
  nock('http://fake-kyc').get('/v1/score').query({ owner: 'A' }).reply(200, { score: 800 });
  nock('http://fake-kyc').get('/v1/score').query({ owner: 'B' }).reply(200, { score: 800 });

  const A = (await request(app).post('/accounts').send({ owner: 'A', initial: 10 }).expect(201)).body.id;
  const B = (await request(app).post('/accounts').send({ owner: 'B', initial: 0 }).expect(201)).body.id;

  const r = await request(app).post('/transfer').send({ fromId: A, toId: B, amount: 50 });
  expect(r.status).toBe(401);
  expect(r.body?.error).toBe('insufficient_funds');
});
