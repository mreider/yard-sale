-- 0002_drop_display_name.sql
-- Drops users.display_name. The column was holding a separate "how you
-- want to be attributed" string, but for a one-off yard-sale product
-- the username already does that job — asking for both at signup was
-- cognitive overhead without a user-facing benefit.
--
-- D1 / SQLite 3.35+ supports DROP COLUMN directly, no table rebuild
-- needed. Existing rows keep their username and everything else; the
-- display_name data is discarded.

ALTER TABLE users DROP COLUMN display_name;
