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
const STAGING_KEY_RE = /^staging\/[A-Za-z0-9._-]+$/;
export const stagingKeySchema = z.string().regex(STAGING_KEY_RE, 'Invalid staging key');
const requiredDoc = (label: string) =>
  z.string({ required_error: `${label} is required` }).regex(STAGING_KEY_RE, `${label} is required`);

// Create accepts a map of document field -> staged key (files were already
// uploaded one-by-one to the staging area as the user attached them). Photo and
// signature are mandatory; the rest are optional.
const documentsSchema = z.object({
  photo: requiredDoc('Customer photo'),
  signature: requiredDoc('Customer signature'),
  aadhaarDoc: stagingKeySchema.optional(),
  panDoc: stagingKeySchema.optional(),
  guarantorPhoto: stagingKeySchema.optional(),
  guarantorAadhaarDoc: stagingKeySchema.optional(),
  guarantorPanDoc: stagingKeySchema.optional(),
  guarantorSignature: stagingKeySchema.optional(),
});

// Base shape with lenient (optional/nullable) fields — used as-is by the Edit
// form, which allows leaving fields blank to keep existing values.
const baseCustomerSchema = z.object({
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

// Create: Name, Mobile, Area, Father, Address, Photo and Signature are all
// mandatory (override the lenient base fields with strict ones).
export const createCustomerSchema = baseCustomerSchema.extend({
  areaId: z.string().min(1, 'Area is required').uuid('Select a valid area'),
  guardianName: z.string().trim().min(1, 'Father / guardian name is required'),
  address: z.string().trim().min(1, 'Address is required'),
  documents: documentsSchema,
});
export type CreateCustomerBody = z.infer<typeof createCustomerSchema>;

// Edit form still uploads via multipart; it never sends the documents map, and
// keeps the lenient base rules so blank fields mean "leave unchanged".
export const updateCustomerSchema = baseCustomerSchema.partial();
export type UpdateCustomerBody = z.infer<typeof updateCustomerSchema>;

// Body for DELETE /customers/staging — discard an abandoned staged upload.
export const unstageSchema = z.object({ key: stagingKeySchema });

// Multer field names — one per uploadable document (used by the Edit form).
export const CUSTOMER_UPLOAD_FIELDS = DOCUMENT_FIELDS.map((name) => ({ name, maxCount: 1 }));
