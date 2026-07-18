import { z } from 'zod';

// Arrives as multipart/form-data — all text fields land as strings on req.body.
const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

export const createCustomerSchema = z.object({
  areaId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  fullName: z.string().min(2, 'Full name is required'),
  guardianName: z.preprocess(emptyToNull, z.string().nullable()),
  mobile: z.string().min(10, 'Valid mobile number required').max(15),
  altMobile: z.preprocess(emptyToNull, z.string().nullable()),
  address: z.preprocess(emptyToNull, z.string().nullable()),
  aadhaarNo: z.preprocess(emptyToNull, z.string().nullable()),
  panNo: z.preprocess(emptyToNull, z.string().nullable()),
  guarantorName: z.preprocess(emptyToNull, z.string().nullable()),
  guarantorMobile: z.preprocess(emptyToNull, z.string().nullable()),
  guarantorAadhaarNo: z.preprocess(emptyToNull, z.string().nullable()),
  guarantorPanNo: z.preprocess(emptyToNull, z.string().nullable()),
  latitude: z.preprocess(emptyToNull, z.coerce.number().min(-90).max(90).nullable()),
  longitude: z.preprocess(emptyToNull, z.coerce.number().min(-180).max(180).nullable()),
  locationAccuracy: z.preprocess(emptyToNull, z.coerce.number().min(0).nullable()),
  locationCapturedAt: z.preprocess(emptyToNull, z.string().nullable()),
});
export type CreateCustomerBody = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.partial();
export type UpdateCustomerBody = z.infer<typeof updateCustomerSchema>;

// Multer field names — one per uploadable document.
export const CUSTOMER_UPLOAD_FIELDS = [
  { name: 'photo', maxCount: 1 },
  { name: 'aadhaarDoc', maxCount: 1 },
  { name: 'panDoc', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
  { name: 'guarantorPhoto', maxCount: 1 },
  { name: 'guarantorAadhaarDoc', maxCount: 1 },
  { name: 'guarantorPanDoc', maxCount: 1 },
  { name: 'guarantorSignature', maxCount: 1 },
];
