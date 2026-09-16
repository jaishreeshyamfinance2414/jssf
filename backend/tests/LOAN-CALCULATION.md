# Loan calculation regression checks

The schedule is the source of expected EMI dues. Daily loans accrue one EMI
starting on the issue date, capped at the scheduled term. Weekly/monthly loans
retain their existing schedule frequency and final-installment rounding.

For each business date:

- Opening expected = scheduled EMI amounts due through that date + penalties
  accrued BEFORE that date.
- Received = collection amounts + separate penalty receipts effective on or
  before that date. Count every receipt once, including separate penalty money.
- Shortfall = max(expected - received, 0).
- Advance balance = max(received - expected, 0).
- Penalty applies when opening expected minus received is strictly greater
  than three regular EMIs. Exactly three EMIs is allowed. Add at most one
  charge per calendar day at the configured percentage of principal.
- Closing expected = opening expected + today's eligible charge. This is the
  expected amount displayed in statements and used for historical labels.
- Prior unpaid penalties DO participate in later days' threshold checks.
  Rebuild from receipts chronologically, not from stored penalty totals, so
  repeated sweeps cannot compound charges for the same day.
- Checks continue daily after maturity, while the base EMI obligation remains
  fixed. Full payment of base obligation plus accrued penalties, or manual
  closure/waiver, stops further entries and charges. When shortfall is within
  the three-EMI allowance, no new penalty is charged even if a balance remains.

Positive receipts are Advance when ahead, Full when caught up, otherwise
Partial. Timing is Delayed when a non-advance receipt leaves arrears or catches
up earlier unpaid dues. Automatic zero-value entries are Advance, On time,
or Missed according to that day's cumulative balance. Missing entries are
generated only after the scheduled day closes.

Statement counts describe historical entries. Dashboard and overdue reports
describe amounts still outstanding now; repaying arrears reduces these current
balances without erasing historical missed days. Full-term payable (including
accrued penalties) is separate from expected dues plus penalties through today.

Run against an isolated, disposable PostgreSQL database only:

```powershell
npm.cmd run build
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55434/jssf_unified_test'
node --test tests/statement-history.test.cjs
```

The test requires a database name ending in `_test`, applies migrations inside
an isolated schema, and removes that schema on completion. It covers historical
boundaries, later receipts, backdated corrections, strict penalty boundaries,
future receipts, repeat sweeps, shared read models, admin create/edit/delete,
ledger reversal, duplicate dates, recovery of deleted automatic entries, and
repair of zero-value Partial labels. Legacy automatic-entry suppressions are
ignored: deleting a row leaves it free for immediate replacement, and a later
sweep restores its date from cumulative coverage if no replacement exists.

Deployment: back up the database, run `npm run migrate` including migrations 020
(daily penalty ledger) and 021 (bounded duplicate-date locks), deploy backend
and frontend together, then run the
statement/penalty sweep. Migration 020 preserves existing schedule charges;
the sweep recalculates active loans under the combined-arrears rule. Manually
closed loans remain frozen. No new EMI installments are created after maturity.
Validate representative loans on staging before production.
Local regression tests are not a production-scale performance benchmark.
