# EduCore Stability Review

This version fixes the confirmed Render/Turso failure:

`SQLite error: cannot rollback - no transaction is active`

The remote `libsql` transaction wrapper is bypassed for Turso, while local SQLite keeps real transactions. It also includes Socket.IO reconnection, safer request error handling, lazy-loaded frontend pages, optimistic chat updates, and reduced conversation-list queries.

## Deploy from the existing local Git repository

Copy this folder's contents into the existing repository folder without copying `.git`, then run:

```powershell
git add .
git commit -m "Fix Turso transaction stability"
git push origin main
```

After Render deploys the commit, verify:

```text
https://educore-qvxl.onrender.com/api/health
```

The response must contain:

```json
"database":"turso"
```

Do not commit `LIBSQL_AUTH_TOKEN`; keep it only in Render Environment Variables.
