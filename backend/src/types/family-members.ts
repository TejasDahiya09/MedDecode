export interface FamilyMemberRow {
  readonly id: string;
  readonly user_id: string;
  readonly name: string;
  readonly relationship: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FamilyMemberItem {
  readonly id: string;
  readonly name: string;
  readonly relationship: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FamilyMemberInput {
  readonly name: string;
  readonly relationship: string | null;
}

export interface FamilyMemberUpdate {
  readonly name?: string;
  readonly relationship?: string | null;
}

export interface FamilyMemberPage {
  readonly items: readonly FamilyMemberItem[];
  readonly pagination: {
    readonly limit: number;
    readonly offset: number;
    readonly returned: number;
    readonly has_more: boolean;
    readonly next_offset: number | null;
  };
}
