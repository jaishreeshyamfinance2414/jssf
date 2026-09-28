const fs = require('fs');

const file = 'e:\\10\\aws\\jssf\\jssf app\\backend\\src\\modules\\customers\\customer.controller.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /async create\(req: Request, res: Response\) \{/g,
  `async create(req: Request, res: Response) {\n    if (req.areaIds && req.body.areaId && !req.areaIds.includes(req.body.areaId)) {\n      throw Forbidden('You can only create customers in your assigned area');\n    }`
);

content = content.replace(
  /async update\(req: Request, res: Response\) \{\r?\n\s*const body = req\.body as UpdateCustomerBody;/g,
  `async update(req: Request, res: Response) {\n    const body = req.body as UpdateCustomerBody;\n    if (req.areaIds && body.areaId && !req.areaIds.includes(body.areaId)) throw Forbidden('You cannot move a customer outside your assigned area');\n    const existing = await customerRepository.findById(req.params.id, req.areaIds);\n    if (!existing) throw NotFound('Customer not found');`
);

content = content.replace(
  /async delete\(req: Request, res: Response\) \{/g,
  `async delete(req: Request, res: Response) {\n    const existing = await customerRepository.findById(req.params.id, req.areaIds);\n    if (!existing) throw NotFound('Customer not found');`
);

content = content.replace(
  /async deactivate\(req: Request, res: Response\) \{/g,
  `async deactivate(req: Request, res: Response) {\n    const existing = await customerRepository.findById(req.params.id, req.areaIds);\n    if (!existing) throw NotFound('Customer not found');`
);

content = content.replace(
  /async activate\(req: Request, res: Response\) \{/g,
  `async activate(req: Request, res: Response) {\n    const existing = await customerRepository.findById(req.params.id, req.areaIds);\n    if (!existing) throw NotFound('Customer not found');`
);

fs.writeFileSync(file, content, 'utf8');
console.log('Done controller');
