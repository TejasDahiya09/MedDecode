export interface ApplicationUserProfile {
  readonly id: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ApplicationUserUpdate {
  readonly name: string | null;
}

export interface HealthProfile {
  readonly id: string;
  readonly user_id: string;
  readonly age: number | null;
  readonly gender: string | null;
  readonly allergies: string[];
  readonly diabetes: boolean;
  readonly hypertension: boolean;
  readonly kidney_disease: boolean;
  readonly liver_disease: boolean;
  readonly asthma: boolean;
  readonly thyroid: boolean;
  readonly pregnancy: boolean | null;
  readonly other_conditions: string[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface HealthProfileInput {
  readonly age: number | null;
  readonly gender: string | null;
  readonly allergies: string[];
  readonly diabetes: boolean;
  readonly hypertension: boolean;
  readonly kidney_disease: boolean;
  readonly liver_disease: boolean;
  readonly asthma: boolean;
  readonly thyroid: boolean;
  readonly pregnancy: boolean | null;
  readonly other_conditions: string[];
}

export type HealthProfileUpdate = Partial<HealthProfileInput>;
