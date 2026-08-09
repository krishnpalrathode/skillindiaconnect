-- Widen the Currency enum beyond India + the GCC.
--
-- EXPAND-only and backward compatible: adding enum values never invalidates an
-- existing row, and code that only ever writes the original seven keeps working.
-- Safe to deploy BEFORE the new containers take traffic.
--
-- Note USD in particular: the Account Settings currency dropdown already offered
-- "USD — US Dollar" while the enum did not contain it, so a candidate who picked
-- it got a validation failure on save. This closes that gap rather than removing
-- the option.
--
-- PostgreSQL 12+ permits several ADD VALUEs in one migration provided none of
-- the new values is USED in the same transaction — this file only declares them.
--
-- AlterEnum
ALTER TYPE "Currency" ADD VALUE 'USD';
ALTER TYPE "Currency" ADD VALUE 'EUR';
ALTER TYPE "Currency" ADD VALUE 'GBP';
ALTER TYPE "Currency" ADD VALUE 'CAD';
ALTER TYPE "Currency" ADD VALUE 'AUD';
ALTER TYPE "Currency" ADD VALUE 'JPY';
ALTER TYPE "Currency" ADD VALUE 'SGD';
ALTER TYPE "Currency" ADD VALUE 'MYR';
