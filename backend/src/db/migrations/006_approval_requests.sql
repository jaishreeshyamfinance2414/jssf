-- Manager-approval queue: a manager's attempt at a sensitive action (loan
-- approve/reject/disburse/close, customer delete, cash handover) is recorded
-- here instead of applying immediately; an admin later approves or rejects it.
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE approval_requests (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  action_type   text NOT NULL,   -- 'loan.approve' | 'loan.reject' | 'loan.disburse' | 'loan.close' | 'customer.delete' | 'collection.handover'
  entity_type   text NOT NULL,   -- 'loan' | 'customer' | 'agent_ledger'
  entity_id     uuid NOT NULL,   -- loan id / customer id / agent (user) id
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        approval_status NOT NULL DEFAULT 'pending',
  requested_by  uuid NOT NULL REFERENCES users(id),
  reviewed_by   uuid REFERENCES users(id),
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_status       ON approval_requests(status);
CREATE INDEX idx_approval_requested_by ON approval_requests(requested_by);
