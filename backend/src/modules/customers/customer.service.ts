import { randomUUID } from 'node:crypto';
import { relativeUploadPath } from '../files/upload';
import { copyObject, deleteObject } from '../files/r2';
import { audit } from '../audit/audit.service';
import { customerRepository } from './customer.repository';
import { CreateCustomerBody, DocumentField, UpdateCustomerBody } from './customer.schema';
import { NotFound } from '../../shared/errors';

type UploadedFiles = Record<string, Express.Multer.File[] | undefined>;

const filePath = (files: UploadedFiles, field: string, category: string) => {
  const file = files[field]?.[0];
  return file ? relativeUploadPath(category, file) : null;
};

/**
 * Commit a staged document into permanent storage: copy staging/<uuid>.<ext>
 * to customers/<uuid>.<ext>, delete the staging copy, and return the new path
 * in the DB's category/filename format. Returns null when no doc was staged.
 * Keeping customers/ separate lets an R2 lifecycle rule expire only staging/.
 */
async function commitStaged(key: string | undefined): Promise<string | null> {
  if (!key) return null;
  const ext = key.slice(key.lastIndexOf('.') === -1 ? key.length : key.lastIndexOf('.'));
  const destKey = `customers/${randomUUID()}${ext}`;
  await copyObject(key, destKey);
  await deleteObject(key); // best-effort; lifecycle rule sweeps any leftover
  return destKey;
}

export const customerService = {
  async create(body: CreateCustomerBody, actorId: string, ip?: string | null) {
    // Commit every staged document up front. If any copy fails the whole create
    // aborts before the DB insert, so we never persist a customer pointing at a
    // document that isn't there.
    const docs = body.documents ?? {};
    const committed = {} as Record<DocumentField, string | null>;
    for (const field of Object.keys(docs) as DocumentField[]) {
      committed[field] = await commitStaged(docs[field]);
    }
    const doc = (field: DocumentField) => committed[field] ?? null;

    const customer = await customerRepository.create({
      areaId: body.areaId,
      fullName: body.fullName,
      guardianName: body.guardianName,
      mobile: body.mobile,
      altMobile: body.altMobile,
      address: body.address,
      photoPath: doc('photo'),
      aadhaarNo: body.aadhaarNo,
      aadhaarPath: doc('aadhaarDoc'),
      panNo: body.panNo,
      panPath: doc('panDoc'),
      signaturePath: doc('signature'),
      guarantorName: body.guarantorName,
      guarantorMobile: body.guarantorMobile,
      guarantorPhotoPath: doc('guarantorPhoto'),
      guarantorAadhaarNo: body.guarantorAadhaarNo,
      guarantorAadhaarPath: doc('guarantorAadhaarDoc'),
      guarantorPanNo: body.guarantorPanNo,
      guarantorPanPath: doc('guarantorPanDoc'),
      guarantorSignaturePath: doc('guarantorSignature'),
      latitude: body.latitude,
      longitude: body.longitude,
      locationAccuracy: body.locationAccuracy,
      locationCapturedAt: body.locationCapturedAt,
      createdBy: actorId,
    });

    await audit({
      actorId,
      action: 'CREATE',
      entity: 'customer',
      entityId: customer.id,
      meta: { fullName: body.fullName, mobile: body.mobile },
      ip,
    });

    return customer;
  },

  async update(id: string, body: UpdateCustomerBody, files: UploadedFiles, actorId: string, ip?: string | null) {
    const existing = await customerRepository.findById(id);
    if (!existing) throw NotFound('Customer not found');

    await customerRepository.update(id, {
      areaId: body.areaId,
      fullName: body.fullName,
      guardianName: body.guardianName,
      mobile: body.mobile,
      altMobile: body.altMobile,
      address: body.address,
      photoPath: filePath(files, 'photo', 'customers'),
      aadhaarNo: body.aadhaarNo,
      aadhaarPath: filePath(files, 'aadhaarDoc', 'customers'),
      panNo: body.panNo,
      panPath: filePath(files, 'panDoc', 'customers'),
      signaturePath: filePath(files, 'signature', 'customers'),
      guarantorName: body.guarantorName,
      guarantorMobile: body.guarantorMobile,
      guarantorPhotoPath: filePath(files, 'guarantorPhoto', 'customers'),
      guarantorAadhaarNo: body.guarantorAadhaarNo,
      guarantorAadhaarPath: filePath(files, 'guarantorAadhaarDoc', 'customers'),
      guarantorPanNo: body.guarantorPanNo,
      guarantorPanPath: filePath(files, 'guarantorPanDoc', 'customers'),
      guarantorSignaturePath: filePath(files, 'guarantorSignature', 'customers'),
      latitude: body.latitude,
      longitude: body.longitude,
      locationAccuracy: body.locationAccuracy,
      locationCapturedAt: body.locationCapturedAt,
    });

    await audit({
      actorId,
      action: 'UPDATE',
      entity: 'customer',
      entityId: id,
      meta: body,
      ip,
    });

    return customerRepository.findById(id);
  },

  async delete(id: string, actorId: string, ip?: string | null) {
    const customer = await customerRepository.findById(id);
    if (!customer) throw NotFound('Customer not found');

    await customerRepository.softDelete(id);
    await audit({
      actorId,
      action: 'DELETE',
      entity: 'customer',
      entityId: id,
      meta: { fullName: customer.full_name, mobile: customer.mobile },
      ip,
    });

    return { deleted: true };
  },
};
