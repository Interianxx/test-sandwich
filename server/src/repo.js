const { getPool } = require('./db');

async function createAccount(owner, balance = 0, conn = null){
  const db = conn || await getPool();
  const [r] = await db.query('INSERT INTO accounts(owner, balance) VALUES (?,?)',[owner,balance]);
  return r.insertId;
}

async function getAccount(id, conn = null){
  const db = conn || await getPool();
  const [rows] = await db.query('SELECT * FROM accounts WHERE id=?',[id]);
  return rows[0] || null;
}

async function transfer(fromId, toId, amount){
  const db = await getPool();
  const conn = await db.getConnection();
  try{
    await conn.beginTransaction();
    const [a] = await conn.query('SELECT balance FROM accounts WHERE id=? FOR UPDATE',[fromId]);
    const [b] = await conn.query('SELECT balance FROM accounts WHERE id=? FOR UPDATE',[toId]);
    if(!a.length || !b.length) throw new Error('account_not_found');
    if(Number(a[0].balance) < amount) throw new Error('insufficient_funds');
    await conn.query('UPDATE accounts SET balance=balance-? WHERE id=?',[amount,fromId]);
    await conn.query('UPDATE accounts SET balance=balance+? WHERE id=?',[amount,toId]);
    await conn.commit();
  }catch(e){
    await conn.rollback(); throw e;
  }finally{
    conn.release();
  }
}

module.exports = { createAccount, getAccount, transfer };
