export const PRESCRIPTION_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf"
] as const;

export type PrescriptionFileType = typeof PRESCRIPTION_FILE_TYPES[number];
export type PrescriptionFileExtension = "jpg" | "png" | "pdf";

export interface ValidatedPrescriptionFile {
  readonly bytes: Buffer;
  readonly fileType: PrescriptionFileType;
  readonly extension: PrescriptionFileExtension;
  readonly sizeBytes: number;
}

export interface PrescriptionInsert {
  readonly id: string;
  readonly user_id: string;
  readonly storage_provider: "aws_s3";
  readonly storage_bucket: string;
  readonly object_key: string;
  readonly file_type: PrescriptionFileType;
  readonly file_size_bytes: number;
  readonly status: "uploaded";
}

export interface PrescriptionRecord extends PrescriptionInsert {
  readonly created_at: string;
  readonly updated_at: string;
}

export const PRESCRIPTION_STATUSES = [
  "uploaded",
  "queued",
  "processing",
  "completed",
  "completed_with_warnings",
  "failed"
] as const;

export type PrescriptionStatus = typeof PRESCRIPTION_STATUSES[number];

/** Database projection used only by the read-only history repository. */
export interface PrescriptionHistoryRow {
  readonly id: string;
  readonly user_id: string;
  readonly file_type: PrescriptionFileType;
  readonly file_size_bytes: number | string | null;
  readonly status: PrescriptionStatus;
  readonly prescription_date: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly processed_at: string | null;
}

/** Public allowlisted representation. Bigint values are serialized as strings. */
export interface PrescriptionHistoryItem {
  readonly id: string;
  readonly file_type: PrescriptionFileType;
  readonly file_size_bytes: string | null;
  readonly status: PrescriptionStatus;
  readonly prescription_date: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly processed_at: string | null;
}

export interface PrescriptionHistoryPage {
  readonly items: readonly PrescriptionHistoryItem[];
  readonly pagination: {
    readonly limit: number;
    readonly offset: number;
    readonly returned: number;
    readonly has_more: boolean;
    readonly next_offset: number | null;
  };
}

export interface PrescriptionDetailResponse {
  readonly prescription: PrescriptionHistoryItem;
}
