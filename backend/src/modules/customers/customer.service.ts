import { randomUUID } from 'node:crypto';
import { relativeUploadPath } from '../files/upload';
import { copyObject, deleteObject } from '../files/r2';
import { audit } from '../audit/audit.service';
import { customerRepository } from './customer.repository';
import { CreateCustomerBody, DocumentField, UpdateCustomerBody } from './customer.schema';
import { Conflict, NotFound } from '../../shared/errors';

type UploadedFiles = Record<string, Express.Multer.File[] | undefined>;

const filePath = (files: UploadedFiles, field: string, category: string) => {
  const file = files[field]?.[0];
  return file ? relativeUploadPath(category, file) : null;
};

/**
 * Copy a staged document into permanent storage: staging/<uuid>.<ext> ->
 * customers/<uuid>.<ext>, returning the new path in the DB's category/filename
 * format. Returns null when no doc was staged. Does NOT delete the staging copy
 * — the caller removes those in one parallel best-effort batch after all copies
 * succeed, so a failed delete can never abort a create mid-way.
 */
async function commitStaged(key: string | undefined): Promise<string | null> {
  if (!key) return null;
  const ext = key.slice(key.lastIndexOf('.') === -1 ? key.length : key.lastIndexOf('.'));
  const destKey = `customers/${randomUUID()}${ext}`;
  await copyObject(key, destKey);
  return destKey;
}

export const customerService = {
  async create(body: CreateCustomerBody, actorId: string, ip?: string | null) {
    // Commit every staged document up front, all copies running in parallel. If
    // any copy fails the whole create aborts before the DB insert, so we never
    // persist a customer pointing at a document that isn't there.
    const docs = body.documents ?? {};
    const fields = Object.keys(docs) as DocumentField[];
    const paths = await Promise.all(fields.map((f) => commitStaged(docs[f])));
    const committed = Object.fromEntries(fields.map((f, i) => [f, paths[i]])) as Record<
      DocumentField,
      string | null
    >;
    const doc = (field: DocumentField) => committed[field] ?? null;

    // Remove the now-redundant staging copies in one parallel, best-effort pass.
    // allSettled means a transient delete failure can't fail the create; the R2
    // staging/ lifecycle rule sweeps anything left behind.
    await Promise.allSettled(fields.map((f) => (docs[f] ? deleteObject(docs[f]!) : Promise.resolve())));

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

    // A customer can only be deleted if they have NEVER had a loan. Any loan —
    // active OR closed — anchors ledger, EMI and collection entries, so deleting
    // the customer would corrupt the books. countLoansFor counts every status.
    const loanCount = await customerRepository.countLoansFor(id);
    if (loanCount > 0) {
      throw Conflict(
        'This customer has loan history and cannot be deleted. ' +
          'Deleting them would affect active loans and financial records.',
      );
    }

    // No loans exist, so no financial/audit dependency on the documents —
    // permanently remove them from R2 alongside the customer row.
    const docPaths = [
      customer.photo_path,
      customer.aadhaar_path,
      customer.pan_path,
      customer.signature_path,
      customer.guarantor_photo_path,
      customer.guarantor_aadhaar_path,
      customer.guarantor_pan_path,
      customer.guarantor_signature_path,
    ].filter(Boolean) as string[];
    // Best-effort: a failed R2 delete must not block removing the customer.
    await Promise.allSettled(docPaths.map((p) => deleteObject(p)));

    await customerRepository.hardDelete(id);
    await audit({
      actorId,
      action: 'DELETE',
      entity: 'customer',
      entityId: id,
      meta: { fullName: customer.full_name, mobile: customer.mobile, documentsDeleted: docPaths.length },
      ip,
    });

    return { deleted: true };
  },

  /**
   * Deactivate (soft-delete) a customer. Allowed only when no loan is currently
   * active — an active loan still has EMIs to collect, so the customer must stay
   * visible/active. Documents are retained (unlike hard delete) because loan
   * history depends on them.
   */
  async deactivate(id: string, actorId: string, ip?: string | null) {
    const customer = await customerRepository.findById(id);
    if (!customer) throw NotFound('Customer not found');
    if (!customer.is_active) throw Conflict('Customer is already deactivated.');

    const activeLoans = await customerRepository.countActiveLoansFor(id);
    if (activeLoans > 0) {
      throw Conflict(
        'This customer has an active loan and cannot be deactivated. ' +
          'Close the loan first, then deactivate.',
      );
    }

    await customerRepository.setActive(id, false);
    await audit({
      actorId,
      action: 'DEACTIVATE',
      entity: 'customer',
      entityId: id,
      meta: { fullName: customer.full_name, mobile: customer.mobile },
      ip,
    });
    return { deactivated: true };
  },

  /** Reactivate a previously deactivated customer. */
  async activate(id: string, actorId: string, ip?: string | null) {
    const customer = await customerRepository.findById(id);
    if (!customer) throw NotFound('Customer not found');
    if (customer.is_active) throw Conflict('Customer is already active.');

    await customerRepository.setActive(id, true);
    await audit({
      actorId,
      action: 'ACTIVATE',
      entity: 'customer',
      entityId: id,
      meta: { fullName: customer.full_name, mobile: customer.mobile },
      ip,
    });
    return { activated: true };
  },
};
