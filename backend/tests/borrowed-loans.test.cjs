const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBorrowedLoanSchema } = require('../dist/modules/borrowed-loans/borrowed-loan.schema');

const common = {
  lenderName: 'Test lender',
  receivingAccountId: '11111111-1111-4111-8111-111111111111',
  loanAmount: 10000,
  receivedDate: '2026-01-01',
  firstPaymentDate: '2026-02-01',
  note: '',
};

test('accepts the distinct payload for each borrowed-loan type', () => {
  const cases = [
    { ...common, loanType: 'reducing_balance', installmentCount: 12, installmentAmount: 1000 },
    { ...common, loanType: 'interest_only', interestPaymentAmount: 250 },
    { ...common, loanType: 'credit_card', financeChargeAmount: 500 },
    { ...common, loanType: 'personal_borrowed', interestAmount: 0 },
  ];

  for (const input of cases) {
    const result = createBorrowedLoanSchema.safeParse(input);
    assert.equal(result.success, true, `${input.loanType} should accept its own fields`);
  }
});

test('rejects fields belonging to a different loan type', () => {
  const cases = [
    { ...common, loanType: 'reducing_balance', installmentCount: 12, installmentAmount: 1000, interestPaymentAmount: 250 },
    { ...common, loanType: 'interest_only', interestPaymentAmount: 250, installmentCount: 12 },
    { ...common, loanType: 'credit_card', financeChargeAmount: 500, installmentAmount: 1000 },
    { ...common, loanType: 'personal_borrowed', interestAmount: 0, interestPaymentAmount: 250 },
  ];

  for (const input of cases) {
    const result = createBorrowedLoanSchema.safeParse(input);
    assert.equal(result.success, false, `${input.loanType} should reject another type's fields`);
  }
});

test('rejects a reducing-balance schedule below the borrowed principal', () => {
  const result = createBorrowedLoanSchema.safeParse({
    ...common,
    loanType: 'reducing_balance',
    installmentCount: 10,
    installmentAmount: 900,
  });

  assert.equal(result.success, false);
  assert.deepEqual(result.error.flatten().fieldErrors.installmentAmount, [
    'Total payable cannot be less than the borrowed amount',
  ]);
});
