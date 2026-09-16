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
    assert.equal(rows[14].type,'full');
    assert.equal(rows[15].type,'missed');
    assert.equal(rows[15].missed_penalty,'0.00');
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
    } finally {
      await pool.end();
    }
  } finally {
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  }
});
