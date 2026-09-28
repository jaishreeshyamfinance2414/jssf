-- Add primary area assignment to users (nullable for admin/manager)
ALTER TABLE users ADD COLUMN IF NOT EXISTS area_id uuid;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_area_id_fkey;
ALTER TABLE users ADD CONSTRAINT users_area_id_fkey FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_users_area ON users(area_id);

UPDATE users u
   SET area_id = assigned.area_id
  FROM (
    SELECT agent_id, min(area_id::text)::uuid AS area_id
      FROM area_agents
     GROUP BY agent_id
    HAVING count(*) = 1
  ) assigned
 WHERE u.id = assigned.agent_id AND u.area_id IS NULL;
