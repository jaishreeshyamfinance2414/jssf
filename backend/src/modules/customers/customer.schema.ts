import { z } from 'zod';

// Arrives as multipart/form-data — all text fields land as strings on req.body.
const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);

// The eight uploadable document slots. Used by the multipart field list (Edit
// form) and the staged-upload document map (Create form) alike.
export const DOCUMENT_FIELDS = [
  'photo',
  'aadhaarDoc',
  'panDoc',
  'signature',
  'guarantorPhoto',
  'guarantorAadhaarDoc',
  'guarantorPanDoc',
  'guarantorSignature',
] as const;
export type DocumentField = (typeof DOCUMENT_FIELDS)[number];

// A staging object key: "staging/<uuid>.<ext>" — single path segment after the
// prefix, no slashes or traversal. Matches what POST /customers/staging returns.
export const stagingKeySchema = z.string().regex(/^staging\/[A-Za-z0-9._-]+$/, 'Invalid staging key');

// Create accepts a map of document field -> staged key (files were already
// uploaded one-by-one to the staging area as the user attached them).
const documentsSchema = z
  .object(Object.fromEntries(DOCUMENT_FIELDS.map((f) => [f, stagingKeySchema.optional()])) as Record<DocumentField, z.ZodOptional<typeof stagingKeySchema>>)
  .partial()
  .default({});

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
  documents: documentsSchema,
});
export type CreateCustomerBody = z.infer<typeof createCustomerSchema>;

// Edit form still uploads via multipart; it never sends the documents map.
export const updateCustomerSchema = createCustomerSchema.omit({ documents: true }).partial();
export type UpdateCustomerBody = z.infer<typeof updateCustomerSchema>;

// Body for DELETE /customers/staging — discard an abandoned staged upload.
export const unstageSchema = z.object({ key: stagingKeySchema });

// Multer field names — one per uploadable document (used by the Edit form).
export const CUSTOMER_UPLOAD_FIELDS = DOCUMENT_FIELDS.map((name) => ({ name, maxCount: 1 }));
