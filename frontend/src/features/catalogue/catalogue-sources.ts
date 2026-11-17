// Centralized source organization mappings for official Indian pharmaceutical datasets.

export interface SourceOrganizationMeta {
  readonly id: string;
  readonly shortName: string;
  readonly fullName: string;
  readonly role: string;
  readonly badgeTone: 'info' | 'success' | 'warning' | 'neutral';
  readonly isPublication?: boolean;
}

export const OFFICIAL_SOURCE_ORGANIZATIONS: Record<string, SourceOrganizationMeta> = {
  india_cdsco_approved: {
    id: 'india_cdsco_approved',
    shortName: 'CDSCO Approval',
    fullName: 'Central Drugs Standard Control Organisation (CDSCO)',
    role: 'Central regulatory body responsible for new drug approvals and clinical trials under MoHFW.',
    badgeTone: 'info',
  },
  india_cdsco_restricted: {
    id: 'india_cdsco_restricted',
    shortName: 'CDSCO Restriction',
    fullName: 'Central Drugs Standard Control Organisation (CDSCO)',
    role: 'Regulatory gazette notifications prohibiting or restricting specific drug combinations.',
    badgeTone: 'warning',
  },
  india_nlem_2022: {
    id: 'india_nlem_2022',
    shortName: 'NLEM 2022 Publication',
    fullName: 'National List of Essential Medicines (NLEM 2022, MoHFW Publication)',
    role: 'Official reference publication by the Ministry of Health and Family Welfare identifying priority essential medicines.',
    badgeTone: 'success',
    isPublication: true,
  },
  india_nppa_prices: {
    id: 'india_nppa_prices',
    shortName: 'NPPA Price Schedule',
    fullName: 'National Pharmaceutical Pricing Authority (NPPA)',
    role: 'Statutory authority under Department of Pharmaceuticals notifying ceiling prices and revised MRPs.',
    badgeTone: 'info',
  },
  india_pmbi: {
    id: 'india_pmbi',
    shortName: 'PMBI Jan Aushadhi',
    fullName: 'Pharmaceuticals & Medical Devices Bureau of India (PMBI)',
    role: 'Bureau under Department of Pharmaceuticals implementing the Pradhan Mantri Bhartiya Janaushadhi Pariyojana.',
    badgeTone: 'success',
  },
  rxnorm: {
    id: 'rxnorm',
    shortName: 'RxNorm Standard',
    fullName: 'National Library of Medicine (RxNorm)',
    role: 'Standardized nomenclature for active pharmaceutical ingredients and clinical drugs.',
    badgeTone: 'neutral',
  },
};

export function formatSourceOrganization(sourceId: string): SourceOrganizationMeta {
  const normalized = sourceId.toLowerCase().trim();
  if (OFFICIAL_SOURCE_ORGANIZATIONS[normalized]) {
    return OFFICIAL_SOURCE_ORGANIZATIONS[normalized];
  }
  if (normalized.includes('cdsco') && /restrict|prohibit|bann/.test(normalized)) return OFFICIAL_SOURCE_ORGANIZATIONS.india_cdsco_restricted;
  if (normalized.includes('cdsco') && /approv|permission/.test(normalized)) return OFFICIAL_SOURCE_ORGANIZATIONS.india_cdsco_approved;
  if (normalized.includes('nlem')) return OFFICIAL_SOURCE_ORGANIZATIONS.india_nlem_2022;
  if (normalized.includes('nppa')) return OFFICIAL_SOURCE_ORGANIZATIONS.india_nppa_prices;
  if (normalized.includes('pmbi') || normalized.includes('jan_aushadhi')) return OFFICIAL_SOURCE_ORGANIZATIONS.india_pmbi;
  if (normalized.includes('rxnorm')) return OFFICIAL_SOURCE_ORGANIZATIONS.rxnorm;

  const prettyName = sourceId
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return {
    id: sourceId,
    shortName: prettyName,
    fullName: prettyName,
    role: 'Source identifier supplied by the catalogue.',
    badgeTone: 'neutral',
  };
}
