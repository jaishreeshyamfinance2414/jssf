const fs = require('fs');
const path = require('path');

const file = 'e:\\10\\aws\\jssf\\jssf app\\backend\\src\\modules\\customers\\customer.repository.ts';
let content = fs.readFileSync(file, 'utf8');

// replace list query
content = content.replace(
  /OR c\.file_number::text = \$1\)\r?\n\s*ORDER BY c\.created_at DESC\r?\n\s*LIMIT 200`,\r?\n\s*\[search \?\? null\],/,
  "OR c.file_number::text = $1)\n          ${areaIds ? 'AND c.area_id = ANY($2::uuid[])' : ''}\n        ORDER BY c.created_at DESC\n        LIMIT 200`,\n      areaIds ? [search ?? null, areaIds] : [search ?? null],"
);

// replace findById query
content = content.replace(
  /WHERE c\.id = \$1`,\r?\n\s*\[id\],/,
  "WHERE c.id = $1 ${areaIds ? 'AND c.area_id = ANY($2::uuid[])' : ''}`,\n      areaIds ? [id, areaIds] : [id],"
);

fs.writeFileSync(file, content, 'utf8');
console.log('Customer repo updated');
