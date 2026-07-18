import { relativeUploadPath } from '../files/upload';
import { audit } from '../audit/audit.service';
import { customerRepository } from './customer.repository';
import { CreateCustomerBody, UpdateCustomerBody } from './customer.schema';
import { NotFound } from '../../shared/errors';

type UploadedFiles = Record<string, Express.Multer.File[] | undefined>;

const filePath = (files: UploadedFiles, field: string, category: string) => {
  const file = files[field]?.[0];
  return file ? relativeUploadPath(category, file) : null;
};

export const customerService = {
  async create(body: CreateCustomerBody, files: UploadedFiles, actorId: string, ip?: string | null) {
    const customer = await customerRepository.create({
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
