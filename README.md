# Mobile App Backend (RestDB)

A small NestJS API used by the Power Soft restaurant mobile app. It runs on the same machine as the SQL Server instance that hosts `RestDB` and exposes three endpoints:

| Method | Path                 | Who             | What it does                                                        |
| ------ | -------------------- | --------------- | ------------------------------------------------------------------- |
| POST   | `/login`             | anyone          | Checks username/password against `JS_Users`, returns a JWT          |
| POST   | `/backup`            | supervisor only | Full database backup, verified, then stamps `JS_Config.Last_Bak_Date` |
| POST   | `/execute-mission-1` | supervisor only | Runs the "initial database" reset script (destructive)              |

The normal flow is: **login → backup → execute-mission-1**, all on the same day.

## Requirements

- Node.js 20 or newer
- SQL Server 2012 or newer (developed against SQL Server 2014, `RestDB` at compatibility level 100)
- A SQL login with `sysadmin` rights (e.g. `sa`). `BACKUP DATABASE`, `xp_create_subdir` and `xp_instance_regread` need it.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values
```

| Variable                | Required | Default     | Description                                                                 |
| ----------------------- | -------- | ----------- | --------------------------------------------------------------------------- |
| `DB_HOST`               | yes      |             | SQL Server host. Use `localhost` when running on the database machine       |
| `DB_PORT`               | no       | `1433`      | SQL Server port                                                             |
| `DB_USERNAME`           | yes      |             | SQL login                                                                   |
| `DB_PASSWORD`           | yes      |             | SQL password                                                                |
| `DB_DATABASE`           | yes      |             | Database name (`RestDB`)                                                    |
| `DB_REQUEST_TIMEOUT_MS` | no       | `1800000`   | Max time for a single SQL request (30 min); backups of large DBs are slow   |
| `PORT`                  | no       | `3000`      | HTTP port                                                                   |
| `JWT_SECRET`            | yes      |             | Long random string used to sign tokens                                      |
| `JWT_EXPIRES_IN`        | no       | `12h`       | Token lifetime (`30m`, `12h`, `7d`, ...)                                    |
| `BACKUP_DIR`            | no       | SQL default | Folder **on the SQL Server machine** for `.bak` files. Empty = SQL Server's default backup folder |

Generate a JWT secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Running

```bash
# development (watch mode)
npm run start:dev

# production
npm run build
npm run start:prod
```

The server listens on `0.0.0.0:PORT`. To reach it from phones on the network, allow the port through Windows Firewall. To keep it running after logoff or reboot, run it as a Windows service (for example with NSSM or pm2).

## API

All errors use the standard NestJS shape: `{ "statusCode", "message", "error" }`. Mission 1 errors also include a `messages` array.

### `POST /login`

```json
{ "username": "admin", "password": "your-password" }
```

Response `200`:

```json
{
  "accessToken": "eyJhbGciOi...",
  "user": { "id": 1, "username": "admin", "name": "مدير النظام", "isSupervisor": true }
}
```

- The username is matched against `JS_Users.Usr_NM` and the password against `JS_Users.Pass`. The desktop system stores passwords as plain text; the comparison is exact.
- Users with `Usr_Stat = 0` are treated as disabled (`403`).
- Wrong username or password returns `401`. Missing fields return `400`.

Send the token on the other endpoints as `Authorization: Bearer <accessToken>`.

### `POST /backup`

No body. Supervisor only (`JS_Users.isSuperVisor = 1`).

1. `BACKUP DATABASE <DB_DATABASE> TO DISK = '<dir>\<DB>_yyyyMMdd_HHmmss.bak' WITH INIT, CHECKSUM`
2. `RESTORE VERIFYONLY ... WITH CHECKSUM` to make sure the file is readable
3. Only after both succeed: `JS_Config.Last_Bak_Date` is set to now, in the same format the desktop system uses (`dd/MM/yyyy hh:mm:ss tt`)

Response `200`:

```json
{
  "success": true,
  "database": "RestDB",
  "filePath": "C:\\Program Files\\Microsoft SQL Server\\MSSQL12.MSSQLSERVER\\MSSQL\\Backup\\RestDB_20261001_003005.bak",
  "sizeBytes": 1731264512,
  "verified": true,
  "lastBackupDate": "01/10/2026 12:31:02 AM",
  "durationMs": 57120
}
```

- `409` if a backup is already running.
- `500` with the SQL Server error if the backup or verification fails. In that case `Last_Bak_Date` is not touched.
- SQL Server itself writes the file, so its service account needs write access to `BACKUP_DIR`. The folder is created if it doesn't exist.

### `POST /execute-mission-1`

No body. Supervisor only. **This deletes data.** It runs [`src/missions/sql/mission-1.sql`](src/missions/sql/mission-1.sql), which:

- refuses to run unless `JS_Config.Last_Bak_Date` is **today** (call `/backup` first)
- truncates or deletes the transactional tables (bills, returns, journals, receipts, stock movements, shifts, supply, sales orders, history, ...)
- deletes `JS_DeliveringREQ` rows older than `20251101`
- resets `JS_Bills_Master` and `JS_HST_BILL_MST` identities to 0
- sets `JS_Products.Qty` and `JS_Materials.Qty` to 0 and `JS_Tables.TB_State` to 0
- resets `JS_Machines.BillIndex` / `RetBillIndex` to 1 when `JS_Config.linkwithTaxSA = 0`

Response `200`. `messages` holds the script's `PRINT` and `DBCC` output:

```json
{
  "success": true,
  "messages": ["Oct  1 2026 12:31AM", "01/10/2026 12:31:02 AM", "2026/10/01 12:33:40 AM", "✅ آخر نسخة احتياطية تمت اليوم", "..."],
  "durationMs": 8421
}
```

Errors:

- `409` with `"error": "BackupRequired"`: no backup was taken today. Nothing was changed.
- `409` with `"error": "Conflict"`: the mission is already running.
- `500` with `"error": "MissionFailed"`: a SQL error happened. The whole transaction was rolled back, so nothing was changed.

#### Differences from the original script

The script is the same as `InitialDataBase_RestaurantSystem_20260101.sql`, with three changes needed to run it safely from the API:

1. **`TRY_CONVERT` was replaced** with `CONVERT(..., 103)` inside `TRY/CATCH`. `RestDB` is at compatibility level 100, where `TRY_CONVERT` doesn't exist, so the original script fails before running anything.
2. **`use RestDB` was removed.** The connection already uses `DB_DATABASE`.
3. **All changes run in one transaction** (`SET XACT_ABORT ON` + `BEGIN TRAN ... COMMIT`, `ROLLBACK` in `CATCH`). If any statement fails, nothing is left half-deleted.

If you edit the `.sql` file, keep it as a single batch: no `GO` lines, and nothing that is invalid at compatibility level 100.

## Postman

Import [`postman/Mobile-App-Backend.postman_collection.json`](postman/Mobile-App-Backend.postman_collection.json).

1. Set the `baseUrl` collection variable (default `http://localhost:3000`).
2. Run **Login** with a supervisor account. The token is saved to `accessToken` automatically, and the other requests use it.
3. Run **Backup**, then **Execute Mission 1**.

Each request has saved example responses for success and for the common errors. Backup and Mission 1 can take minutes, so keep Postman's request timeout at 0 (Settings → General). Mobile clients also need a long HTTP timeout for these two calls.

## Project structure

```text
src/
  main.ts                    bootstrap, validation pipe
  app.module.ts
  database/                  mssql connection pool, batch runner (collects PRINT messages)
  auth/                      POST /login, JWT guard, supervisor guard
  backup/                    POST /backup
  missions/
    missions.service.ts      POST /execute-mission-1
    sql/mission-1.sql        the reset script (copied to dist/ on build)
postman/                     Postman collection
```
