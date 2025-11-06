# Banco – Pruebas de integración “sándwich” con Jest

Este repositorio contiene:
- Un backend Node.js (CommonJS) en `server/` con Express y MySQL real.
- Pruebas de integración tipo sándwich (HTTP real contra Express con Supertest arriba + MySQL real abajo + servicio externo KYC fingido con Nock).
- Un frontend React (plantilla Vite) opcional en `src/` sin integración directa con el backend (sólo de ejemplo).

## Requisitos
- Node.js 18+ y npm o yarn.
- MySQL accesible (local o remoto) con credenciales de lectura/escritura.

## Estructura
- `server/` backend (Express + MySQL + Jest/Nock/Supertest)
  - `src/` código fuente
    - `app.js` fabrica `makeApp({ kycBase })` y rutas HTTP
    - `service.js` reglas de negocio (KYC y transferencias)
    - `repo.js` acceso a datos (MySQL)
    - `db.js` pool de conexiones MySQL
  - `schema.sql` DDL de la tabla `accounts`
  - `tests/transfer.sandwich.test.js` pruebas de integración sándwich
  - `.env.example` variables de entorno de MySQL/KYC
- `README.md` este archivo

## Variables de entorno (server/.env)
Copia el ejemplo y ajusta credenciales:

1) Copia: `server/.env.example` → `server/.env`
2) Edita:
- `MYSQL_HOST` (p.ej. 127.0.0.1)
- `MYSQL_PORT` (por defecto 3306)
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE` (por defecto `bank_test` si no se define)
- `KYC_BASE` (base URL del servicio KYC; en tests se usa un fake con Nock; no necesitas que exista)

## Base de datos
El fichero `server/schema.sql` crea la base `bank_test` y la tabla `accounts`. Las pruebas lo ejecutan automáticamente antes de correr (usando una conexión “raw” a MySQL), por lo que sólo necesitas que MySQL esté disponible y las credenciales sean correctas.

Si quieres aplicarlo manualmente:
- Abre un cliente MySQL y ejecuta el contenido de `server/schema.sql`.

## Cómo ejecutar las pruebas (sándwich)
Dentro de `server/`:

- Instala dependencias: `npm i`
- Ejecuta pruebas: `npm test`

Qué ocurre durante los tests:
- Se carga `.env` para obtener credenciales MySQL.
- Se aplica `schema.sql` (crea DB y tabla si no existen).
- Se “limpia” la tabla `accounts` antes de cada test.
- Se crea la app Express con `makeApp({ kycBase:'http://fake-kyc' })`.
- Se interceptan las llamadas HTTP hacia `http://fake-kyc` con Nock (servicio KYC fingido).
- Se ejercita la API vía Supertest (HTTP real in-memory) y se valida el estado en MySQL real.

Comandos útiles:
- `cd server && npm i`
- `cd server && npm test`

## API del backend (rutas)
Las rutas se definen en `server/src/app.js` y usan `BankService`:

- GET `/health` → `{ ok: true }`
- POST `/accounts` body: `{ owner, initial }`
  - 201 `{ id }` en éxito
  - 403 `{ error:'kyc_rejected' }` si KYC rechaza
  - 400 `{ error }` para otros errores
- GET `/accounts/:id/balance`
  - 200 `{ balance }` en éxito
  - 404 `{ error:'account_not_found' }`
- POST `/transfer` body: `{ fromId, toId, amount }`
  - 200 `{ ok:true }` en éxito
  - 409 `{ error:'insufficient_funds' }`
  - 404 `{ error:'account_not_found' }`
  - 400 `{ error }` para otros errores

Nota: el proyecto no incluye un “server.js” que lance Express escuchando un puerto. Las pruebas crean la app con `makeApp` y la ejercitan en memoria. Si quieres levantar el servidor manualmente, puedes crear un archivo temporal (no incluido por defecto) como:

```js
// server/run-local.js (ejemplo opcional)
require('dotenv').config();
const { makeApp } = require('./src/app');
const app = makeApp({ kycBase: process.env.KYC_BASE || 'http://kyc.local' });
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Listening on', port));
```

y ejecutarlo con `node server/run-local.js` (asegúrate de tener `.env` y MySQL listos).

## ¿Qué son las pruebas “sándwich” y por qué usarlas?
“Arriba REAL, abajo REAL, dependencia externa fingida”. Este enfoque valida el sistema casi “de punta a punta”, pero manteniendo estable y controlable la dependencia externa.

- Capa de arriba REAL: se prueba la API HTTP de Express con Supertest. No se mockea Express ni el router; se serializa/deserializa JSON y se validan códigos de estado.
- Capa de abajo REAL: se usa MySQL real con transacciones/locks. Se valida que el esquema y las consultas funcionen en un motor real.
- Dependencia externa fingida: el servicio KYC se simula con Nock, que intercepta peticiones HTTP hacia `kycBase`. Así mantenemos determinismo, velocidad y no dependemos de terceros.

Ventajas
- Alto grado de confianza: el flujo completo (HTTP → servicio → repositorio → MySQL) está bajo prueba.
- Tests deterministas y rápidos: la pieza inestable (KYC externo) se simula.
- Detecta problemas de integración reales (SQL, transacciones, códigos HTTP, contratos JSON).

Trade-offs
- Requiere infraestructura local (MySQL accesible).
- No reemplaza end-to-end completos en entorno real, pero reduce mucho el riesgo.

## Problemas comunes
- ECONNREFUSED/ER_ACCESS_DENIED_ERROR: revisa `.env` de `server/` y que MySQL esté levantado y accesible.
- La base no existe: las pruebas ejecutan `schema.sql`; asegúrate de que el usuario de MySQL tenga permisos de CREATE DATABASE.
- Puerto ocupado al correr localmente: cambia `PORT` en `.env`.

## Cómo usar el proyecto
- Caso típico: simplemente ejecuta las pruebas en `server/`. Verás ejemplos de uso de la API (crear cuentas, transferir, consultar balances) en `tests/transfer.sandwich.test.js`.
- Si levantas el servidor manualmente (ver snippet opcional), puedes interactuar con curl o Postman:
  - `curl -X POST http://localhost:3000/accounts -H "Content-Type: application/json" -d "{\"owner\":\"Alice\",\"initial\":1000}"`
  - `curl http://localhost:3000/accounts/1/balance`
  - `curl -X POST http://localhost:3000/transfer -H "Content-Type: application/json" -d "{\"fromId\":1,\"toId\":2,\"amount\":250}"`

## Licencia
Uso educativo/demostrativo.


## FAQ
### ¿Por qué el test de "fondos insuficientes" aparece como PASSED si es un error?
Porque el objetivo del test es verificar que la aplicación responda con el error correcto. En pruebas, un caso negativo “pasa” cuando el sistema devuelve exactamente lo que se espera para ese escenario de error.

En el test Fondos insuficientes → 409, se espera que la API responda con:
- Código HTTP 409
- Cuerpo `{ error: 'insufficient_funds' }`

Si la API devolviera 200 o un error distinto, el test fallaría. Por eso, ver PASSED significa “el sistema manejó correctamente la situación de fondos insuficientes”.

### ¿Cómo puedo ver ese test fallar a propósito?
- Opción 1: Cambia la expectativa del test temporalmente. Por ejemplo, cambia `expect(r.status).toBe(409)` por `expect(r.status).toBe(200)` y ejecútalo: el test debe FALLAR.
- Opción 2: Rompe la lógica en `server/src/repo.js` o `server/src/service.js` que lanza `insufficient_funds` (no recomendado en código real, solo educativo).

### ¿Cómo ejecuto sólo ese test?
Dentro de `server/`:
- `npm test -- -t "Fondos insuficientes"`

Esto ejecuta únicamente los tests cuyo nombre contenga “Fondos insuficientes”.

### ¿Dónde se instancia Supertest?
No hay una “instancia” global que tengas que crear manualmente. Se importa la función `supertest` y se usa como `request(app)` (en el test la variable `request` es el import de supertest). Cada llamada `request(app)` crea un cliente HTTP en memoria contra tu app de Express.

Ejemplo minimal basado en nuestros tests:

```js
const request = require('supertest');
const { makeApp } = require('./src/app');

const app = makeApp({ kycBase: 'http://fake-kyc' });

// Crear cuenta
await request(app)
  .post('/accounts')
  .send({ owner: 'Alice', initial: 1000 })
  .expect(201);

// Si quisieras mantener cookies/sesión entre múltiples requests, usa:
// const agent = request.agent(app);
// await agent.post('/login').send({ user, pass });
// await agent.get('/me').expect(200);
```

En nuestro repo, esto ocurre en `server/tests/transfer.sandwich.test.js`:
- `const request = require('supertest')`
- `const app = makeApp({ kycBase: 'http://fake-kyc' })`
- Luego se invoca `request(app).post(...).expect(...)`.
