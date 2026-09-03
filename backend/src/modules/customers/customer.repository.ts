import { query } from '../../db/pool';

export interface CreateCustomerInput {
  areaId: string | null;
  fullName: string;
  guardianName: string | null;
  mobile: string;
  altMobile: string | null;
  address: string | null;
  photoPath: string | null;
  aadhaarNo: string | null;
  aadhaarPath: string | null;
  panNo: string | null;
  panPath: string | null;
  signaturePath: string | null;
  guarantorName: string | null;
  guarantorMobile: string | null;
  guarantorPhotoPath: string | null;
  guarantorAadhaarNo: string | null;
  guarantorAadhaarPath: string | null;
  guarantorPanNo: string | null;
  guarantorPanPath: string | null;
  guarantorSignaturePath: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  locationCapturedAt: string | null;
  work: string | null;
  homeType: string | null;
  electricityBillPath: string | null;
  createdBy: string;
}

export interface UpdateCustomerInput {
  areaId?: string | null;
  fullName?: string;
  guardianName?: string | null;
  mobile?: string;
  altMobile?: string | null;
  address?: string | null;
  photoPath?: string | null;
  aadhaarNo?: string | null;
  aadhaarPath?: string | null;
  panNo?: string | null;
  panPath?: string | null;
  signaturePath?: string | null;
  guarantorName?: string | null;
  guarantorMobile?: string | null;
  guarantorPhotoPath?: string | null;
  guarantorAadhaarNo?: string | null;
  guarantorAadhaarPath?: string | null;
  guarantorPanNo?: string | null;
  guarantorPanPath?: string | null;
  guarantorSignaturePath?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracy?: number | null;
  locationCapturedAt?: string | null;
  work?: string | null;
  homeType?: string | null;
  electricityBillPath?: string | null;
}

export const customerRepository = {
  async create(input: CreateCustomerInput): Promise<{ id: string; file_number: number }> {
    const { rows } = await query<{ id: string; file_number: number }>(
      `INSERT INTO customers(
         area_id, full_name, guardian_name, mobile, alt_mobile, address,
         photo_path, aadhaar_no, aadhaar_path, pan_no, pan_path, signature_path,
         guarantor_name, guarantor_mobile, guarantor_photo_path,
         guarantor_aadhaar_no, guarantor_aadhaar_path, guarantor_pan_no, guarantor_pan_path,
         guarantor_signature_path, latitude, longitude, location_accuracy, location_captured_at, work, home_type, electricity_bill_path, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING id, file_number`,
      [
        input.areaId,
        input.fullName,
        input.guardianName,
        input.mobile,
        input.altMobile,
        input.address,
        input.photoPath,
        input.aadhaarNo,
        input.aadhaarPath,
        input.panNo,
        input.panPath,
        input.signaturePath,
        input.guarantorName,
        input.guarantorMobile,
        input.guarantorPhotoPath,
        input.guarantorAadhaarNo,
        input.guarantorAadhaarPath,
        input.guarantorPanNo,
        input.guarantorPanPath,
        input.guarantorSignaturePath,
        input.latitude,
        input.longitude,
        input.locationAccuracy,
        input.locationCapturedAt,
        input.work,
        input.homeType,
        input.electricityBillPath,
        input.createdBy,
      ],
    );
    return rows[0];
  },

  async update(id: string, input: UpdateCustomerInput): Promise<void> {
    await query(
      `UPDATE customers
          SET area_id = COALESCE($2, area_id),
              full_name = COALESCE($3, full_name),
              guardian_name = $4,
              mobile = COALESCE($5, mobile),
              alt_mobile = $6,
              address = $7,
              photo_path = COALESCE($8, photo_path),
              aadhaar_no = $9,
              aadhaar_path = COALESCE($10, aadhaar_path),
              pan_no = $11,
              pan_path = COALESCE($12, pan_path),
              signature_path = COALESCE($13, signature_path),
              guarantor_name = $14,
              guarantor_mobile = $15,
              guarantor_photo_path = COALESCE($16, guarantor_photo_path),
              guarantor_aadhaar_no = $17,
              guarantor_aadhaar_path = COALESCE($18, guarantor_aadhaar_path),
              guarantor_pan_no = $19,
              guarantor_pan_path = COALESCE($20, guarantor_pan_path),
              guarantor_signature_path = COALESCE($21, guarantor_signature_path),
              latitude = $22,
              longitude = $23,
              location_accuracy = $24,
              location_captured_at = $25,
              work = $26,
              home_type = $27,
              electricity_bill_path = COALESCE($28, electricity_bill_path)
        WHERE id = $1`,
      [
        id,
        input.areaId,
        input.fullName,
        input.guardianName ?? null,
        input.mobile,
        input.altMobile ?? null,
        input.address ?? null,
        input.photoPath ?? null,
        input.aadhaarNo ?? null,
        input.aadhaarPath ?? null,
        input.panNo ?? null,
        input.panPath ?? null,
        input.signaturePath ?? null,
        input.guarantorName ?? null,
        input.guarantorMobile ?? null,
        input.guarantorPhotoPath ?? null,
        input.guarantorAadhaarNo ?? null,
        input.guarantorAadhaarPath ?? null,
        input.guarantorPanNo ?? null,
        input.guarantorPanPath ?? null,
        input.guarantorSignaturePath ?? null,
        input.latitude ?? null,
        input.longitude ?? null,
        input.locationAccuracy ?? null,
        input.locationCapturedAt ?? null,
        input.work ?? null,
        input.homeType ?? null,
        input.electricityBillPath ?? null,
      ],
    );
  },

  /**
   * @param status which customers to return:
   *   'active'      — is_active = true (default)
   *   'deactivated' — is_active = false (soft-deleted / deactivated)
   *   'closed_loan' — active customers whose loans are ALL closed (>=1 loan,
   *                   0 active) — the candidates for deactivation
   *   'all'         — every customer regardless of status
   * Rows include active_loan_count and total_loan_count so the UI can decide
   * which of Delete / Deactivate / Activate applies to each customer.
   */
  async list(search?: string, status: 'active' | 'deactivated' | 'closed_loan' | 'all' = 'active') {
    const statusFilter =
      status === 'active'
        ? 'c.is_active = true'
        : status === 'deactivated'
          ? 'c.is_active = false'
          : status === 'closed_loan'
            ? `c.is_active = true
               AND EXISTS (SELECT 1 FROM loans l WHERE l.customer_id = c.id)
               AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.customer_id = c.id AND l.status = 'active')`
            : 'true'; // 'all'
    const { rows } = await query(
      `SELECT c.id, c.file_number, c.full_name, c.mobile, c.alt_mobile, c.photo_path, c.is_active, c.created_at,
              a.name AS area_name,
              (SELECT count(*) FROM loans l WHERE l.customer_id = c.id AND l.status = 'active') AS active_loan_count,
              (SELECT count(*) FROM loans l WHERE l.customer_id = c.id) AS total_loan_count
         FROM customers c LEFT JOIN areas a ON a.id = c.area_id
        WHERE ${statusFilter}
          AND ($1::text IS NULL OR c.full_name ILIKE '%'||$1||'%' OR c.mobile ILIKE '%'||$1||'%'
               OR c.file_number::text = $1)
        ORDER BY c.created_at DESC
        LIMIT 200`,
      [search ?? null],
    );
    return rows;
  },

  async findById(id: string) {
    const { rows } = await query(
      `SELECT c.*, a.name AS area_name FROM customers c LEFT JOIN areas a ON a.id = c.area_id WHERE c.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  },

  async loanHistory(customerId: string) {
    const { rows } = await query(
      `SELECT id, loan_number, principal, status, emi_frequency, tenure_count, loan_date, created_at
         FROM loans WHERE customer_id = $1 ORDER BY created_at DESC`,
      [customerId],
    );
    return rows;
  },

  async softDelete(id: string): Promise<void> {
    await query(`UPDATE customers SET is_active = false WHERE id = $1`, [id]);
  },

  /** Flip a customer's active flag (deactivate = false, activate = true). */
  async setActive(id: string, isActive: boolean): Promise<void> {
    await query(`UPDATE customers SET is_active = $2 WHERE id = $1`, [id, isActive]);
  },

  /**
   * Permanently remove a customer row. Only safe when the customer has never
   * had a loan — loans reference customers with ON DELETE RESTRICT, and the
   * service enforces the zero-loan rule before calling this.
   */
  async hardDelete(id: string): Promise<void> {
    await query(`DELETE FROM customers WHERE id = $1`, [id]);
  },

  async countLoansFor(customerId: string): Promise<number> {
    const { rows } = await query<{ c: string }>(
      `SELECT count(*)::text AS c FROM loans WHERE customer_id = $1`,
      [customerId],
    );
    return Number(rows[0].c);
  },

  async countActiveLoansFor(customerId: string): Promise<number> {
    const { rows } = await query<{ c: string }>(
      `SELECT count(*)::text AS c FROM loans WHERE customer_id = $1 AND status = 'active'`,
      [customerId],
    );
    return Number(rows[0].c);
  },
};
