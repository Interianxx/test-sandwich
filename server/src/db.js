require('dotenv').config();
const mysql = require('mysql2/promise');
let pool;
async function getPool(){
  if(!pool){
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE || 'bank_test',
      port: Number(process.env.MYSQL_PORT || 3306),
      waitForConnections: true,
      connectionLimit: 10
    });
  }
  return pool;
}
module.exports = { getPool };
