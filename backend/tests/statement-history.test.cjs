// Run after npm run build with TEST_DATABASE_URL pointing at a disposable
// PostgreSQL database whose name ends in _test. No application DB is used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { reconcileHistory, reconcileHistoricalPenalties } = require('../dist/modules/collections/statement-history');

test('historical statement coverage, corrections and penalties', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url && new URL(url).pathname.endsWith('_test'), 'Use a disposable TEST_DATABASE_URL ending in _test');
  const db = new Client({ connectionString: url });
  await db.connect();
  const schema = `history_test_${Date.now()}`;
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}, public`);
    await db.query("SET TIME ZONE 'Asia/Kolkata'");
    const dir = join(__dirname, '../src/db/migrations');
    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      await db.query(readFileSync(join(dir, file), 'utf8'));
    }
    await db.query("INSERT INTO settings(key,value) VALUES ('penalty', jsonb_build_object('per_day_pct',1))");
    const customer = (await db.query("INSERT INTO customers(full_name,mobile) VALUES ('History fixture','0000000000') RETURNING id")).rows[0].id;
    const loan = (await db.query(`INSERT INTO loans(loan_number,customer_id,principal,duration_days,emi_amount,total_payable,status,loan_date)
      VALUES ('HISTORY',$1,20000,120,200,24000,'active',CURRENT_DATE-40) RETURNING id`, [customer])).rows[0].id;
    await db.query(`INSERT INTO emi_schedule(loan_id,installment_no,due_date,due_amount)
      SELECT $1,n,CURRENT_DATE-41+n,200 FROM generate_series(1,120)n`, [loan]);
    const pay = async (day, amount) => (await db.query(`INSERT INTO collections(loan_id,emi_id,amount,type,mode,collected_at)
      SELECT loan_id,id,$3,'full','cash',due_date::timestamp+interval '10 hours'
      FROM emi_schedule WHERE loan_id=$1 AND installment_no=$2 RETURNING id`, [loan,day,amount])).rows[0].id;
    const reconcile = async () => {
      await reconcileHistory(loan, db);
      await reconcileHistoricalPenalties(loan, db);
    };
    const types = async () => (await db.query(`SELECT e.installment_no,c.type,c.amount,e.missed_penalty
      FROM emi_schedule e LEFT JOIN collections c ON c.loan_id=e.loan_id AND c.collected_at::date=e.due_date
      WHERE e.loan_id=$1 AND e.installment_no<=20 ORDER BY e.installment_no`, [loan])).rows;
    const first = await pay(1,2000);
    const later = await pay(15,200);
    await reconcile();
    let rows = await types();
    assert.equal(rows[8].type,'advance');
    assert.equal(rows[9].type,'full');
    assert.equal(rows[10].type,'missed');
    assert.equal(rows[13].missed_penalty,'200.00');
    assert.equal(rows[14].type,'partial', 'One EMI receipt is partial when cumulative arrears remain');
    assert.equal(rows[15].type,'missed');
    assert.equal(rows[14].missed_penalty,'200.00', 'One EMI paid does not waive penalty while shortfall exceeds 3 EMIs');
    assert.equal(rows[15].missed_penalty,'200.00');
    const original = rows.slice(0,14);
    // Changing a later payment must not rewrite earlier days, even if large.
    await db.query('UPDATE collections SET amount=4000 WHERE id=$1',[later]);
    await reconcile();
    rows = await types();
    assert.deepEqual(rows.slice(0,14),original);
    assert.equal(rows[15].type,'advance');
    // Backdated correction genuinely changes coverage from that date onward.
    await db.query('UPDATE collections SET amount=3000 WHERE id=$1',[first]);
    await reconcile();
    rows = await types();
    assert.equal(rows[9].type,'advance');
    assert.equal(rows[10].type,'advance');
    assert.equal(rows[13].missed_penalty,'0.00');
    // Restore and repair the previous bug's incorrect Advance/Full markers.
    await db.query('UPDATE collections SET amount=2000 WHERE id=$1',[first]);
    await db.query('UPDATE collections SET amount=200 WHERE id=$1',[later]);
    await db.query(`UPDATE collections SET type='advance', note='Auto-marked: installment covered by advance payment'
      WHERE loan_id=$1 AND amount=0`,[loan]);
    await reconcile();
    assert.deepEqual((await types()).slice(0,14), original);
    // Delete/recreate later payment; the old advance boundary stays put.
    const removedDate = (await db.query('DELETE FROM collections WHERE id=$1 RETURNING collected_at',[later])).rows[0].collected_at;
    await reconcileHistory(loan, db, removedDate);
    assert.equal((await types())[14].type,null, 'Deletion must leave the date free for replacement');
    const replacement = await pay(15,200);
    await reconcile();
    assert.deepEqual((await types()).slice(0,14),original);
    // Move later payment to day 2: receipt dates, not the old EMI anchor, win.
    await db.query(`DELETE FROM collections WHERE loan_id=$1 AND amount=0 AND collected_at::date=
      (SELECT due_date FROM emi_schedule WHERE loan_id=$1 AND installment_no=2)`,[loan]);
    await db.query(`UPDATE collections SET collected_at=(SELECT due_date::timestamp+interval '10 hours'
      FROM emi_schedule WHERE loan_id=$1 AND installment_no=2) WHERE id=$2`,[loan,replacement]);
    await reconcile();
    rows = await types();
    assert.equal(rows[9].type,'advance');
    assert.equal(rows[10].type,'full');
    assert.equal(rows[11].type,'missed');
    // Future-dated money must not backfill historical coverage.
    await pay(50,2000);
    const beforeFuture = await types();
    await reconcile();
    assert.deepEqual(await types(),beforeFuture);
    // Repeated sweep is idempotent and never inserts two rows on a date.
    const snapshot = await types();
    await reconcileHistory(null,db);
    await reconcileHistoricalPenalties(null,db);
    await reconcile();
    assert.deepEqual(await types(),snapshot);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM (
      SELECT collected_at::date FROM collections WHERE loan_id=$1
      GROUP BY collected_at::date HAVING count(*)>1) d`,[loan])).rows[0].n,0);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM collections
      WHERE loan_id=$1 AND amount=0 AND collected_at::date>=CURRENT_DATE`,[loan])).rows[0].n,0);

    const second = (await db.query(`INSERT INTO loans(loan_number,customer_id,principal,duration_days,emi_amount,total_payable,status,loan_date)
      VALUES ('HISTORY-100',$1,10000,120,100,12000,'active',CURRENT_DATE-40) RETURNING id`,[customer])).rows[0].id;
    await db.query(`INSERT INTO emi_schedule(loan_id,installment_no,due_date,due_amount)
      SELECT $1,n,CURRENT_DATE-41+n,100 FROM generate_series(1,120)n`,[second]);
    await db.query(`INSERT INTO collections(loan_id,amount,type,mode,collected_at)
      VALUES ($1,100,'full','cash',(CURRENT_DATE-40)::timestamp+interval '10 hours'),
             ($1,2000,'advance','cash',(CURRENT_DATE-39)::timestamp+interval '10 hours')`,[second]);
    await reconcileHistory(second,db);
    const boundary = (await db.query(`SELECT e.installment_no,c.type FROM emi_schedule e
      JOIN collections c ON c.loan_id=e.loan_id AND c.collected_at::date=e.due_date
      WHERE e.loan_id=$1 AND e.installment_no IN (3,20,21,22) ORDER BY e.installment_no`,[second])).rows;
    assert.deepEqual(boundary.map(r=>r.type),['advance','advance','full','missed']);

    // Four days at 200 = 800 due today. Compare exact numeric boundaries,
    // including one paise above the 600 grace allowance.
    const threshold = (await db.query(`INSERT INTO loans(loan_number,customer_id,principal,duration_days,emi_amount,total_payable,status,loan_date)
      VALUES ('PENALTY-BOUNDARY',$1,20000,120,200,24000,'active',CURRENT_DATE-3) RETURNING id`,[customer])).rows[0].id;
    await db.query(`INSERT INTO emi_schedule(loan_id,installment_no,due_date,due_amount)
      SELECT $1,n,CURRENT_DATE-4+n,200 FROM generate_series(1,120)n`,[threshold]);
    const receipt = (await db.query(`INSERT INTO collections(loan_id,amount,penalty,type,mode,collected_at)
      VALUES ($1,200,0,'full','cash',CURRENT_DATE::timestamp+interval '1 minute') RETURNING id`,[threshold])).rows[0].id;
    const penaltyToday = async () => Number((await db.query(`SELECT missed_penalty FROM emi_schedule
      WHERE loan_id=$1 AND due_date=CURRENT_DATE`,[threshold])).rows[0].missed_penalty);
    for (const amount of [200,200.01,199.99,199,100,800,1000]) {
      await db.query('UPDATE collections SET amount=$2 WHERE id=$1',[receipt,amount]);
      await reconcileHistoricalPenalties(threshold,db);
      assert.equal(await penaltyToday(), 0, `Open day must not incur a penalty, receipt ${amount}`);
      assert.equal(Number((await db.query('SELECT total_payable FROM loans WHERE id=$1',[threshold])).rows[0].total_payable),24000);
      await reconcileHistoricalPenalties(threshold,db);
      assert.equal(await penaltyToday(),0,'Repeated recalculation must not charge an open day');
    }
    // Separate penalty receipts also reduce the combined shortfall.
    await db.query('UPDATE collections SET amount=0,penalty=200 WHERE id=$1',[receipt]);
    await reconcileHistoricalPenalties(threshold,db);
    assert.equal(await penaltyToday(),0);
    // Deleting the receipt restores the shortfall, even without a missed marker.
    await db.query('DELETE FROM collections WHERE id=$1',[receipt]);
    await reconcileHistoricalPenalties(threshold,db);
    assert.equal(await penaltyToday(),0);
    assert.equal(Number((await db.query(`SELECT sum(missed_penalty) AS n FROM emi_schedule
      WHERE loan_id=$1 AND due_date>CURRENT_DATE`,[threshold])).rows[0].n),0);

    // The same boundary becomes chargeable only after the collection day ends.
    const completedBoundary = (await db.query(`INSERT INTO loans(loan_number,customer_id,principal,duration_days,emi_amount,total_payable,status,loan_date)
      VALUES ('COMPLETED-BOUNDARY',$1,20000,120,200,24000,'active',CURRENT_DATE-4) RETURNING id`,[customer])).rows[0].id;
    await db.query(`INSERT INTO emi_schedule(loan_id,installment_no,due_date,due_amount)
      SELECT $1,n,CURRENT_DATE-5+n,200 FROM generate_series(1,120)n`,[completedBoundary]);
    const completedReceipt = (await db.query(`INSERT INTO collections(loan_id,amount,type,mode,collected_at)
      VALUES ($1,200,'full','cash',(CURRENT_DATE-1)::timestamp+interval '23 hours 59 minutes') RETURNING id`,[completedBoundary])).rows[0].id;
    for (const [amount, expected] of [[200,0],[200.01,0],[199.99,200],[199,200],[100,200],[800,0],[1000,0]]) {
      await db.query('UPDATE collections SET amount=$2 WHERE id=$1',[completedReceipt,amount]);
      await reconcileHistoricalPenalties(completedBoundary,db);
      const charge = (await db.query(`SELECT missed_penalty FROM emi_schedule WHERE loan_id=$1 AND due_date=CURRENT_DATE-1`,[completedBoundary])).rows[0];
      assert.equal(Number(charge.missed_penalty),expected, `Closed day: ${amount} received against 800 due`);
      assert.equal(Number((await db.query('SELECT total_payable FROM loans WHERE id=$1',[completedBoundary])).rows[0].total_payable),24000+expected);
    }

    // Exercise the actual hourly/manual sweep twice, including financial EMI
    // allocation. Its current-balance rebuild must not corrupt dated history.
    const appUrl = new URL(url);
    appUrl.searchParams.set('options', `-c search_path=${schema},public -c timezone=Asia/Kolkata`);
    Object.assign(process.env, {
      DATABASE_URL: appUrl.toString(), NODE_ENV: 'test', PGSSLMODE: 'disable',
      JWT_ACCESS_SECRET: 'local-history-test-access', JWT_REFRESH_SECRET: 'local-history-test-refresh',
      R2_ENDPOINT: 'http://localhost:9999', R2_BUCKET: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test',
    });
    const { sweepMissedEmis } = require('../dist/modules/collections/missed-emi.job');
    const { pool } = require('../dist/db/pool');
    try {
      await sweepMissedEmis();
      await sweepMissedEmis();
      assert.deepEqual(await types(),snapshot);
      const { loanRepository } = require('../dist/modules/loans/loan.repository');
      const { collectionRepository } = require('../dist/modules/collections/collection.repository');
      // A moved payment still has its old EMI anchor. Display the charge for
      // the actual entry date, both in loan statements and the collection list.
      const statement = await loanRepository.collectionsFor(loan);
      const ledger = await collectionRepository.list();
      for (const result of [statement, ledger.filter(r=>r.loan_id===loan)]) {
        const moved = result.find(r=>r.id===replacement);
        assert.ok(moved);
        assert.equal(Number(moved.missed_penalty),0);
      }
      assert.equal(statement.find(r=>r.id===first).timing,'advance');
      const detail = await loanRepository.findById(loan);
      const accrued = Number(detail.total_penalty);
      assert.equal(Number(detail.expected_till_today),8200 + accrued);
      assert.equal(Number(detail.received_till_today),2200,'Future receipts excluded from current balance');
      assert.equal(Number(detail.due_till_today),6000 + accrued);
      // Existing charges must be included even when their amounts did not change.
      await db.query('UPDATE loans SET total_payable=24000 WHERE id=$1',[loan]);
      assert.equal(Number((await loanRepository.findById(loan)).total_payable),24000+accrued);
      await sweepMissedEmis();
      assert.equal(Number((await db.query('SELECT total_payable FROM loans WHERE id=$1',[loan])).rows[0].total_payable),24000+accrued);
      await db.query('UPDATE loans SET total_payable=99999 WHERE id=$1',[loan]);
      await sweepMissedEmis();
      assert.equal(Number((await db.query('SELECT total_payable FROM loans WHERE id=$1',[loan])).rows[0].total_payable),24000+accrued);
      // Premature charges from the previous version must be hidden immediately
      // and removed by reconciliation, including their schedule mirror.
      await db.query(`INSERT INTO loan_daily_penalties(loan_id,penalty_date,amount)
        VALUES ($1,CURRENT_DATE,200) ON CONFLICT (loan_id,penalty_date) DO UPDATE SET amount=200`,[loan]);
      await db.query(`UPDATE emi_schedule SET missed_penalty=200 WHERE loan_id=$1 AND due_date=CURRENT_DATE`,[loan]);
      await db.query('UPDATE loans SET total_payable=total_payable+200 WHERE id=$1',[loan]);
      assert.equal(Number((await loanRepository.findById(loan)).total_penalty),accrued);
      assert.equal(Number((await loanRepository.findById(loan)).total_payable),24000+accrued);
      await sweepMissedEmis();
      assert.equal(Number((await db.query(`SELECT count(*) AS n FROM loan_daily_penalties
        WHERE loan_id=$1 AND penalty_date>=CURRENT_DATE`,[loan])).rows[0].n),0);
      const currentEmi = (await db.query(`SELECT missed_penalty,status FROM emi_schedule WHERE loan_id=$1 AND due_date=CURRENT_DATE`,[loan])).rows[0];
      assert.equal(Number(currentEmi.missed_penalty),0);
      assert.equal(currentEmi.status,'pending');
      assert.equal(Number((await db.query('SELECT total_payable FROM loans WHERE id=$1',[loan])).rows[0].total_payable),24000+accrued);
      assert.equal(Number((await db.query('SELECT sum(paid_amount) AS paid FROM emi_schedule WHERE loan_id=$1',[loan])).rows[0].paid),2200);
      const sheet = (await collectionRepository.sheet()).find(r=>r.loan_id===loan);
      assert.equal(Number(sheet.due_till_today),6000 + accrued);
      assert.equal(Number(sheet.received),2200);
      await collectionRepository.todaysDue();
      await loanRepository.list();
      await loanRepository.searchActive('HISTORY');
      const { dashboardRepository } = require('../dist/modules/dashboard/dashboard.repository');
      const { reportsRepository } = require('../dist/modules/reports/reports.repository');
      const report = (await reportsRepository.missedEmi()).find(r=>r.loan_number==='HISTORY');
      assert.equal(Number(report.overdue_amount),5800 + accrued);
      const reportLedger = await reportsRepository.customerLedger(customer);
      assert.equal(Number(reportLedger.loans.find(r=>r.id===loan).due_till_today),6000 + accrued);
      await dashboardRepository.missedEmiSummary();
      await dashboardRepository.overdueLoans();
      await dashboardRepository.todaysDue();
      await dashboardRepository.todaysMissed();
      await dashboardRepository.outstandingPrincipal();
      // Exercise the public mutation service, not only reconciliation helpers.
      const { collectionService } = require('../dist/modules/collections/collection.service');
      const role = (await db.query("INSERT INTO roles(name,label) VALUES ('test-admin','Test admin') RETURNING id")).rows[0].id;
      const actor = (await db.query(`INSERT INTO users(role_id,full_name,mobile,password_hash)
        VALUES ($1,'Test Admin','0000000001','test-only') RETURNING id`,[role])).rows[0].id;
      const branch = (await db.query("INSERT INTO branches(name,code) VALUES ('Test branch','TEST') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO accounts(branch_id,name,type) VALUES ($1,'Test cash','cash')",[branch]);
      const today = (await db.query('SELECT CURRENT_DATE::text AS day')).rows[0].day;
      // Correct a swapped 500-day / ₹120 EMI loan after a real collection.
      // The contract, dated disbursement, cash balance and profit must agree.
      const cashAccount = (await db.query("SELECT id FROM accounts WHERE name='Test cash'")).rows[0].id;
      const swapLoan = (await db.query(`INSERT INTO loans(loan_number,customer_id,principal,duration_days,
        emi_amount,total_payable,interest_amount,emi_frequency,tenure_count,status,loan_date,disbursed_at)
        VALUES ('SWAPPED',$1,50000,500,120,60000,10000,'daily',500,'active',CURRENT_DATE-2,
          CURRENT_DATE-2+interval '12 hours') RETURNING id`,[customer])).rows[0].id;
      await db.query(`INSERT INTO account_transactions(account_id,direction,amount,source,txn_date)
        VALUES ($1,'credit',1000000,'capital',CURRENT_DATE-10)`,[cashAccount]);
      await db.query(`INSERT INTO account_transactions(account_id,direction,amount,source,reference_id,txn_date)
        VALUES ($1,'debit',50000,'loan_disbursement',$2,CURRENT_DATE-2)`,[cashAccount,swapLoan]);
      await db.query(`INSERT INTO emi_schedule(loan_id,installment_no,due_date,due_amount)
        SELECT $1,n,CURRENT_DATE-3+n,120 FROM generate_series(1,500)n`,[swapLoan]);
      await db.query(`INSERT INTO collections(loan_id,emi_id,amount,type,mode,collected_at)
        SELECT $1,id,120,'full','cash',CURRENT_DATE-2+interval '10 hours'
          FROM emi_schedule WHERE loan_id=$1 AND installment_no=1`,[swapLoan]);
      await db.query(`INSERT INTO account_transactions(account_id,direction,amount,source,txn_date)
        VALUES ($1,'credit',120,'collection',CURRENT_DATE-2)`,[cashAccount]);
      const correctedDate = (await db.query("SELECT (CURRENT_DATE-3)::text AS day")).rows[0].day;
      const { loanService } = require('../dist/modules/loans/loan.service');
      await loanService.update(swapLoan,{principal:51000,tenureCount:120,emiAmount:500,loanDate:correctedDate},actor,undefined,'admin');
      const corrected = (await db.query(`SELECT count(*)::int AS count, sum(due_amount)::text AS total,
        min(due_amount)::text AS minimum, max(due_amount)::text AS maximum
        FROM emi_schedule WHERE loan_id=$1`,[swapLoan])).rows[0];
      assert.deepEqual([corrected.count,Number(corrected.total),Number(corrected.minimum),Number(corrected.maximum)],
        [120,60000,500,500]);
      const correctedLoan = (await loanRepository.findById(swapLoan));
      assert.equal(Number(correctedLoan.total_payable),60000);
      assert.equal(Number(correctedLoan.interest_amount),9000);
      assert.equal(Number(correctedLoan.received_till_today),120);
      const debit = (await db.query(`SELECT amount,txn_date::text AS day FROM account_transactions
        WHERE source='loan_disbursement' AND reference_id=$1`,[swapLoan])).rows[0];
      assert.equal(Number(debit.amount),51000);
      assert.equal(debit.day,correctedDate);
      assert.equal(await dashboardRepository.availableCash(),949120);
      const correctedProfit = await reportsRepository.profitLoss(correctedDate,correctedDate);
      assert.equal(correctedProfit.disbursed,51000);
      assert.equal(correctedProfit.interestBooked,9000);
      await assert.rejects(loanService.update(swapLoan,{loanDate:today},actor,undefined,'admin'),
        /after an existing collection date/);
      assert.equal((await db.query(`SELECT txn_date::text AS day FROM account_transactions
        WHERE source='loan_disbursement' AND reference_id=$1`,[swapLoan])).rows[0].day,correctedDate);
      const input = {loanId:threshold,amount:200,penalty:0,type:'full',mode:'cash',collectedDate:today};
      const entry = await collectionService.record(input,actor,'admin');
      let actual = (await loanRepository.collectionsFor(threshold)).find(r=>r.id===entry.id);
      assert.equal(actual.type,'partial');
      assert.equal(actual.timing,'delayed');
      assert.equal(await penaltyToday(),0,'Exactly three EMIs of arrears is allowed');
      await assert.rejects(collectionService.record(input,actor,'admin'),/already has an entry/);
      await collectionService.update(entry.id,{amount:1000},actor,'admin');
      actual = (await loanRepository.collectionsFor(threshold)).find(r=>r.id===entry.id);
      assert.equal(actual.type,'advance','Amount edit must override stale Partial type');
      assert.equal(actual.agent_name,'Test Admin');
      const advanceSummary = await loanRepository.findById(threshold);
      assert.equal(Number(advanceSummary.expected_till_today),800);
      assert.equal(Number(advanceSummary.received_till_today),1000);
      assert.equal(Number(advanceSummary.due_till_today),-200,'Statement shortfall is Expected minus Paid');
      assert.equal(Number(advanceSummary.advance_balance),200);
      await collectionService.update(entry.id,{amount:800},actor,'admin');
      actual = (await loanRepository.collectionsFor(threshold)).find(r=>r.id===entry.id);
      assert.equal(actual.type,'full');
      assert.equal(actual.timing,'delayed','Catching up does not erase prior arrears');
      const earlier = (await loanRepository.collectionsFor(threshold)).filter(r=>r.amount==='0.00').at(-1);
      await assert.rejects(collectionService.update(entry.id,{collectedDate:earlier.entry_date},actor,'admin'),/already has an entry/);
      await collectionService.remove(entry.id,actor,'admin');
      assert.equal(await penaltyToday(),0);
      assert.equal(Number((await db.query("SELECT count(*) AS n FROM account_transactions WHERE reference_id=$1",[entry.id])).rows[0].n),0);
      const replacementEntry = await collectionService.record({...input,amount:1000},actor,'admin');
      assert.ok(replacementEntry.id);
      await collectionService.update(earlier.id,{type:'full',amount:1000},actor,'admin');
      actual = (await loanRepository.collectionsFor(threshold)).find(r=>r.id===earlier.id);
      assert.equal(actual.type,'advance');
      assert.equal(actual.agent_name,'Test Admin');
      const automatic = (await loanRepository.collectionsFor(threshold)).find(r=>r.amount==='0.00' && r.type==='advance');
      assert.ok(automatic);
      // A zero-value Partial edit is derived again, not left as an invalid label.
      await collectionService.update(automatic.id,{type:'partial',amount:0},actor,'admin');
      actual = (await loanRepository.collectionsFor(threshold)).find(r=>r.id===automatic.id);
      assert.equal(actual.type,'advance');
      await collectionService.remove(automatic.id,actor,'admin');
      // Suppressions left behind by older deployments must also be ignored.
      await db.query(`INSERT INTO statement_entry_suppressions(emi_id,loan_id,suppressed_by)
        VALUES ($1,$2,$3) ON CONFLICT (emi_id) DO NOTHING`,[automatic.emi_id,threshold,actor]);
      await sweepMissedEmis();
      const restored = (await loanRepository.collectionsFor(threshold)).filter(r=>r.entry_date===automatic.entry_date);
      assert.equal(restored.length,1, 'Sweep restores exactly one deleted automatic entry');
      assert.equal(restored[0].type,'advance');
      assert.equal(restored[0].agent_name,'Automatic');
      // Removing both receipts leaves arrears. The next sweep must restore
      // the historical payment date as Missed, not preserve advance coverage.
      await collectionService.remove(earlier.id,actor,'admin');
      await collectionService.remove(replacementEntry.id,actor,'admin');
      await sweepMissedEmis();
      actual = (await loanRepository.collectionsFor(threshold)).find(r=>r.entry_date===earlier.entry_date);
      assert.equal(actual.type,'missed');
      assert.equal(actual.amount,'0.00');
      // Repair stale zero-value Partial records created by older code too.
      await db.query("UPDATE collections SET type='partial' WHERE id=$1",[actual.id]);
      await sweepMissedEmis();
      actual = (await loanRepository.collectionsFor(threshold)).find(r=>r.id===actual.id);
      assert.equal(actual.type,'missed');
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM (
        SELECT loan_id,collected_at::date FROM collections GROUP BY loan_id,collected_at::date HAVING count(*)>1
      ) duplicates`)).rows[0].n,0);

      // Matured contract: four EMIs only, but seven calendar days of checks.
      const maturedLoan = (await db.query(`INSERT INTO loans(loan_number,customer_id,principal,duration_days,emi_amount,total_payable,status,loan_date)
        VALUES ('MATURED',$1,20000,4,200,800,'active',CURRENT_DATE-6) RETURNING id`,[customer])).rows[0].id;
      await db.query(`INSERT INTO emi_schedule(loan_id,installment_no,due_date,due_amount)
        SELECT $1,n,CURRENT_DATE-7+n,200 FROM generate_series(1,4)n`,[maturedLoan]);
      const afterTermPayment = (await db.query(`INSERT INTO collections(loan_id,amount,type,mode,collected_at)
        VALUES ($1,300,'partial','cash',(CURRENT_DATE-2)::timestamp+interval '10 hours') RETURNING id`,[maturedLoan])).rows[0].id;
      await sweepMissedEmis();
      const maturityCharges = async () => (await db.query(`SELECT penalty_date::text,amount FROM loan_daily_penalties
        WHERE loan_id=$1 ORDER BY penalty_date`,[maturedLoan])).rows;
      let dailyCharges = await maturityCharges();
      assert.equal(dailyCharges.length,3,'Charges continue after maturity, but only for completed days');
      assert.ok(dailyCharges.every(r=>r.amount==='200.00'));
      assert.equal(Number((await loanRepository.findById(maturedLoan)).expected_till_today),1400);
      assert.equal(Number((await db.query('SELECT sum(due_amount) AS n FROM emi_schedule WHERE loan_id=$1',[maturedLoan])).rows[0].n),800,'Contracted EMI debt never grows past maturity');
      const afterTermEntry = (await loanRepository.collectionsFor(maturedLoan)).find(r=>r.id===afterTermPayment);
      assert.equal(Number(afterTermEntry.expected_by_day),1200,'800 contract + 200 earlier penalty + 200 new penalty');
      assert.equal(Number(afterTermEntry.missed_penalty),200,'500 EMI arrears + 200 prior penalty exceeds the 600 threshold');
      // Exactly 600 combined arrears is allowed; one paise more is not.
      await collectionService.update(afterTermPayment,{amount:400},actor,'admin');
      assert.equal((await maturityCharges()).length,1);
      assert.equal(Number((await loanRepository.findById(maturedLoan)).total_payable),1000);
      await collectionService.update(afterTermPayment,{amount:399.99},actor,'admin');
      assert.equal((await maturityCharges()).length,3);
      await collectionService.update(afterTermPayment,{amount:300},actor,'admin');
      dailyCharges = await maturityCharges();
      await sweepMissedEmis();
      assert.deepEqual(await maturityCharges(),dailyCharges,'Repeated sweeps do not compound stored charges');
      // 500 EMI + 600 prior penalties settles today; today's new penalty is
      // not charged because the receipt clears the opening combined balance.
      const payoff = await collectionService.record({loanId:maturedLoan,amount:500,penalty:600,type:'full',mode:'cash'},actor,'admin');
      let settled = await loanRepository.findById(maturedLoan);
      assert.equal(settled.status,'closed');
      assert.equal(Number(settled.total_payable),1400);
      assert.equal(Number(settled.remaining),0);
      dailyCharges = await maturityCharges();
      await sweepMissedEmis();
      assert.deepEqual(await maturityCharges(),dailyCharges,'Paid loans stop accruing');
      await collectionService.remove(payoff.id,actor,'admin');
      assert.equal((await loanRepository.findById(maturedLoan)).status,'active');
      assert.equal((await maturityCharges()).length,3,'Deleting payoff restores arrears without charging the open day');
      const afterTermAuto = (await loanRepository.collectionsFor(maturedLoan)).find(r=>r.emi_id===null && r.amount==='0.00');
      assert.ok(afterTermAuto,'Post-maturity missed days have automatic entries without inventing an EMI');
      await collectionService.remove(afterTermAuto.id,actor,'admin');
      await sweepMissedEmis();
      const recovered = (await loanRepository.collectionsFor(maturedLoan)).filter(r=>r.entry_date===afterTermAuto.entry_date);
      assert.equal(recovered.length,1);
      assert.equal(recovered[0].type,'missed');
      // Manual waiver freezes the statement/charges and accounts for penalties.
      await loanService.close(maturedLoan,{waiver:true,reason:'Test settlement'},actor);
      settled = await loanRepository.findById(maturedLoan);
      assert.equal(settled.status,'closed');
      assert.equal(Number(settled.waiver_amount),1100);
      const finalStatement = await loanRepository.collectionsFor(maturedLoan);
      dailyCharges = await maturityCharges();
      await sweepMissedEmis();
      assert.deepEqual(await maturityCharges(),dailyCharges);
      assert.deepEqual(await loanRepository.collectionsFor(maturedLoan),finalStatement);
      await assert.rejects(collectionService.update(afterTermPayment,{amount:400},actor,'admin'),/manually closed/);

      const concurrentLoan = (await db.query(`INSERT INTO loans(loan_number,customer_id,principal,duration_days,emi_amount,total_payable,status,loan_date)
        VALUES ('CONCURRENT',$1,20000,120,200,24000,'active',CURRENT_DATE) RETURNING id`,[customer])).rows[0].id;
      await db.query(`INSERT INTO emi_schedule(loan_id,installment_no,due_date,due_amount)
        SELECT $1,n,CURRENT_DATE+n-1,200 FROM generate_series(1,120)n`,[concurrentLoan]);
      const concurrentInput = {loanId:concurrentLoan,amount:200,penalty:0,type:'full',mode:'cash'};
      const attempts = await Promise.allSettled([
        collectionService.record(concurrentInput,actor,'admin'),
        collectionService.record(concurrentInput,actor,'admin'),
      ]);
      assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(attempts.filter(r=>r.status==='rejected').length,1);
      assert.equal((await loanRepository.collectionsFor(concurrentLoan)).length,1);

      // Bounded load regression: each loan has 120 installments but 180 days
      // of history. Exercise bulk sweep, not a per-loan loop in the test.
      const loadLoans = (await db.query(`INSERT INTO loans(loan_number,customer_id,principal,duration_days,emi_amount,total_payable,status,loan_date)
        SELECT 'LOAD-'||n,$1,20000,120,200,24000,'active',CURRENT_DATE-179
          FROM generate_series(1,100)n RETURNING id`,[customer])).rows;
      await db.query(`INSERT INTO emi_schedule(loan_id,installment_no,due_date,due_amount)
        SELECT l.id,n,CURRENT_DATE-180+n,200 FROM loans l CROSS JOIN generate_series(1,120)n
         WHERE l.loan_number LIKE 'LOAD-%'`);
      const startSweep = Date.now();
      await sweepMissedEmis();
      console.log(`100-loan / 180-day sweep completed in ${Date.now()-startSweep} ms`);
      const loadTotals = (await db.query(`SELECT count(*)::int AS n,min(total_payable) AS minimum,max(total_payable) AS maximum
        FROM loans WHERE loan_number LIKE 'LOAD-%'`)).rows[0];
      assert.equal(loadTotals.n,100);
      assert.equal(Number(loadTotals.minimum),59200); // 24,000 + 176 completed-day charges of 200
      assert.equal(Number(loadTotals.maximum),59200);
      assert.equal(Number((await db.query(`SELECT count(*) AS n FROM collections c JOIN loans l ON l.id=c.loan_id
        WHERE l.loan_number LIKE 'LOAD-%'`)).rows[0].n),17900);
      // A backdated full payoff removes unnecessary later system rows and
      // reverses later charges. No extra EMI debt survives the correction.
      const prepaid = loadLoans[0].id;
      const firstDay = (await db.query('SELECT loan_date::text AS day FROM loans WHERE id=$1',[prepaid])).rows[0].day;
      const firstAuto = (await db.query('SELECT id FROM collections WHERE loan_id=$1 AND collected_at::date=$2::date',[prepaid,firstDay])).rows[0].id;
      await collectionService.update(firstAuto,{type:'full',amount:24000},actor,'admin');
      assert.equal((await loanRepository.findById(prepaid)).status,'closed');
      assert.equal(Number((await loanRepository.findById(prepaid)).total_payable),24000);
      assert.equal((await loanRepository.collectionsFor(prepaid)).length,1);
      assert.equal((await db.query('SELECT txn_date::text AS day FROM account_transactions WHERE reference_id=$1',[firstAuto])).rows[0].day,firstDay);
      await sweepMissedEmis();
      assert.equal((await loanRepository.collectionsFor(prepaid)).length,1);
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM (
        SELECT loan_id,collected_at::date FROM collections GROUP BY loan_id,collected_at::date HAVING count(*)>1
      ) duplicates`)).rows[0].n,0);
    } finally {
      await pool.end();
    }
  } finally {
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  }
});
