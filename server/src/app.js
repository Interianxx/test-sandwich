const express = require('express');
const { BankService } = require('./service');

function makeApp({ kycBase }){
  const app = express();
  app.use(express.json());

  const svc = new BankService({ kycBase });

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  // Create account
  app.post('/accounts', async (req, res) => {
    try{
      const { owner, initial } = req.body || {};
      const id = await svc.openAccount(owner, initial);
      res.status(201).json({ id });
    }catch(err){
      const msg = err && err.message ? err.message : 'error';
      if(msg === 'kyc_rejected') return res.status(403).json({ error: msg });
      res.status(400).json({ error: msg });
    }
  });

  // Get balance
  app.get('/accounts/:id/balance', async (req, res) => {
    try{
      const balance = await svc.getBalance(Number(req.params.id));
      res.status(200).json({ balance });
    }catch(err){
      const msg = err && err.message ? err.message : 'error';
      if(msg === 'account_not_found') return res.status(404).json({ error: msg });
      res.status(400).json({ error: msg });
    }
  });

  // Transfer
  app.post('/transfer', async (req, res) => {
    try{
      const { fromId, toId, amount } = req.body || {};
      await svc.transferMoney(Number(fromId), Number(toId), Number(amount));
      res.status(200).json({ ok: true });
    }catch(err){
      const msg = err && err.message ? err.message : 'error';
      if(msg === 'insufficient_funds') return res.status(409).json({ error: msg });
      if(msg === 'account_not_found') return res.status(404).json({ error: msg });
      res.status(400).json({ error: msg });
    }
  });

  return app;
}

module.exports = { makeApp };
