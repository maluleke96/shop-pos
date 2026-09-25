-- Manager Operations integration columns (assign person + manager, linked to shop systems)
-- Safe to re-run: ADD COLUMN failures for existing cols are ignored by ensureSchema migrator.

-- mo_daily_tasks: who does it + which manager owns it
-- (applied via ensureMoColumns in manager-operations.js for Postgres/SQLite compatibility)
