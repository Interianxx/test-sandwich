const axios = require('axios');
const { createAccount, getAccount, transfer } = require('./repo');

class BankService{
  constructor({ kycBase }){ this.kycBase = kycBase; }

  async openAccount(owner, initial){
    const r = await axios.get(`${this.kycBase}/v1/score`, { params:{ owner } });
    if(Number(r.data.score) < 500) throw new Error('kyc_rejected');
    return await createAccount(owner, Number(initial || 0));
  }

  async transferMoney(fromId, toId, amount){
    if(amount <= 0) throw new Error('invalid_amount');
    await transfer(fromId, toId, Number(amount));
    return { ok: true };
  }

  async getBalance(id){
    const acc = await getAccount(id);
    if(!acc) throw new Error('account_not_found');
    return Number(acc.balance);
  }
}

module.exports = { BankService };
