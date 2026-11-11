/** Database projection used only by the owner-scoped cabinet repository. */
export interface MedicineCabinetRow {
  readonly id: string;
  readonly user_id: string;
  readonly medicine_id: string;
  readonly quantity: number | string | null;
  readonly purchase_date: string | null;
  readonly expiry_date: string | null;
  readonly refill_date: string | null;
  readonly usage_information: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Public allowlist. PostgreSQL numeric values are serialized as strings. */
export interface MedicineCabinetItem {
  readonly id: string;
  readonly medicine_id: string;
  readonly quantity: string | null;
  readonly purchase_date: string | null;
  readonly expiry_date: string | null;
  readonly refill_date: string | null;
  readonly usage_information: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MedicineCabinetPage {
  readonly items: readonly MedicineCabinetItem[];
  readonly pagination: {
    readonly limit: number;
    readonly offset: number;
    readonly returned: number;
    readonly has_more: boolean;
    readonly next_offset: number | null;
  };
}

export interface MedicineCabinetDetailResponse {
  readonly entry: MedicineCabinetItem;
}
