import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Skeleton } from '../../components/ui';
import { ApiError } from '../../services/api-client';
import {
  fetchMedicineCatalogueDetail,
  type CatalogueMedicineDetail,
} from '../catalogue/medicine-catalogue-api';
import type { ContractV1MedicineItem } from './prescription-api';
import {
  assessSameFormulation,
  hasCompleteIngredientEvidence,
  hasCompleteFormulationIdentity,
  matchesReportedCatalogueMatch,
  parseOfficialCatalogueId,
} from './same-formulation-alternatives';

const MAX_CANDIDATES_TO_VERIFY = 20;
const EMPTY_ALTERNATIVES: NonNullable<ContractV1MedicineItem['alternatives']> = [];

type VerificationState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'insufficient'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'verified';
      readonly original: CatalogueMedicineDetail;
      readonly candidates: readonly CatalogueMedicineDetail[];
      readonly withheld: number;
      readonly retryableWithheld: boolean;
    };

type VerificationPlan = {
  readonly state: VerificationState | null;
  readonly candidateIds: readonly string[];
  readonly invalidClaimCount: number;
  readonly shouldVerify: boolean;
};

function allMatchClaimsArePositive(
  alternative: NonNullable<ContractV1MedicineItem['alternatives']>[number],
): boolean {
  return alternative.match_basis.ingredient_equivalence
    && alternative.match_basis.strength_compatibility
    && alternative.match_basis.dosage_form_compatibility;
}

function failureMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return 'Sign in again to verify catalogue evidence. No alternative is shown until verification succeeds.';
  }
  if (error instanceof ApiError && error.status === 503) {
    return 'The official catalogue is temporarily unavailable. No alternative is shown until verification succeeds.';
  }
  return 'Catalogue evidence could not be loaded. No alternative is shown until verification succeeds.';
}

function AlternativeCard({
  original,
  candidate,
}: {
  readonly original: CatalogueMedicineDetail;
  readonly candidate: CatalogueMedicineDetail;
}) {
  const detailsUrl = `/medicine-library?source=official_catalogue&q=${encodeURIComponent(candidate.canonical_name)}&detail=${encodeURIComponent(candidate.id)}`;
  const compareUrl = `/compare-medicines?a=${encodeURIComponent(original.id)}&b=${encodeURIComponent(candidate.id)}&source=official_catalogue`;

  return (
    <Card className="border-[var(--cc-border)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="font-semibold text-[var(--cc-text)]">{candidate.canonical_name}</h4>
        <Badge tone="info">Reference attribute match</Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--cc-muted)]">Active ingredients and strengths</dt>
          <dd className="mt-1 text-[var(--cc-text-soft)]">
            {candidate.ingredients.map((ingredient) =>
              `${ingredient.name} ${ingredient.strength_value ?? ''} ${ingredient.strength_unit ?? ''}`.trim(),
            ).join(' + ')}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--cc-muted)]">Dosage form</dt>
          <dd className="mt-1 text-[var(--cc-text-soft)]">{candidate.dosage_form}</dd>
        </div>
        {candidate.brand_name ? (
          <div>
            <dt className="text-xs text-[var(--cc-muted)]">Source-reported brand</dt>
            <dd className="mt-1 text-[var(--cc-text-soft)]">{candidate.brand_name}</dd>
          </div>
        ) : null}
        {candidate.formulation_identity?.manufacturer_name ? (
          <div>
            <dt className="text-xs text-[var(--cc-muted)]">Source-reported manufacturer</dt>
            <dd className="mt-1 text-[var(--cc-text-soft)]">{candidate.formulation_identity.manufacturer_name}</dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="text-xs text-[var(--cc-muted)]">Official source record</dt>
          <dd className="mt-1 break-all font-mono text-xs text-[var(--cc-text-soft)]">
            {candidate.sources[0]} · source record {candidate.formulation_identity?.source_record_id} · catalogue {candidate.id}
          </dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link className="cc-button cc-button--secondary text-xs" to={detailsUrl}>
          View source details
        </Link>
        <Link className="cc-button cc-button--secondary text-xs" to={compareUrl}>
          Compare reference fields
        </Link>
      </div>
    </Card>
  );
}

export function VerifiedAlternativesSection({
  medicine,
  accessToken,
}: {
  readonly medicine: ContractV1MedicineItem;
  readonly accessToken: string;
}) {
  const alternatives = medicine.alternatives ?? EMPTY_ALTERNATIVES;
  const originalId = parseOfficialCatalogueId(medicine.medicine_match.medicine_external_id);
  const hasCompleteReportedMatch = Boolean(medicine.medicine_match.ingredients?.length
    && hasCompleteIngredientEvidence(medicine.medicine_match.ingredients)
    && medicine.medicine_match.dosage_form?.trim()
    && hasCompleteFormulationIdentity(medicine.medicine_match.formulation_identity));
  const [retry, setRetry] = useState(0);
  const plan = useMemo<VerificationPlan>(() => {
    const insufficient = (message: string): VerificationPlan => ({
      state: { kind: 'insufficient', message },
      candidateIds: [],
      invalidClaimCount: 0,
      shouldVerify: false,
    });

    if (medicine.medicine_match.status !== 'matched') {
      return { state: null, candidateIds: [], invalidClaimCount: 0, shouldVerify: false };
    }
    if (!originalId) {
      return insufficient('Insufficient evidence to assess same-formulation alternatives.');
    }
    if (alternatives.length === 0) {
      return { state: { kind: 'empty' }, candidateIds: [], invalidClaimCount: 0, shouldVerify: false };
    }
    if (!hasCompleteReportedMatch) {
      return insufficient('Insufficient evidence to assess same-formulation alternatives.');
    }
    if (!accessToken) {
      return insufficient('Sign in to verify the proposed catalogue records. No alternative is shown without source verification.');
    }

    const claimed = alternatives.filter(allMatchClaimsArePositive);
    const parsedCandidateIds = claimed.map((alternative) =>
      parseOfficialCatalogueId(alternative.medicine_external_id),
    );
    const candidateIds = [...new Set(parsedCandidateIds
      .filter((id): id is string => id !== null && id.toLowerCase() !== originalId.toLowerCase()))];
    const invalidClaimCount = alternatives.length - claimed.length
      + parsedCandidateIds.filter((id) => id === null || id.toLowerCase() === originalId.toLowerCase()).length
      + Math.max(0, parsedCandidateIds.filter((id): id is string => id !== null).length - candidateIds.length);

    if (alternatives.length > MAX_CANDIDATES_TO_VERIFY || candidateIds.length > MAX_CANDIDATES_TO_VERIFY) {
      return insufficient('Too many proposed records were returned to verify safely in this view. No alternative is shown.');
    }
    if (candidateIds.length === 0) {
      return insufficient('Insufficient evidence to verify the proposed catalogue records. No alternative is shown.');
    }

    return { state: null, candidateIds, invalidClaimCount, shouldVerify: true };
  }, [accessToken, alternatives, hasCompleteReportedMatch, medicine.medicine_match.status, originalId]);
  const requestKey = JSON.stringify([
    medicine.medicine_match,
    alternatives,
    accessToken ? 'authenticated' : 'anonymous',
    retry,
  ]);
  const [storedState, setStoredState] = useState<{
    readonly key: string;
    readonly value: VerificationState;
  }>({ key: '', value: { kind: 'loading' } });
  const state = plan.state
    ?? (storedState.key === requestKey ? storedState.value : { kind: 'loading' as const });

  useEffect(() => {
    if (!plan.shouldVerify || !originalId) return;

    let active = true;
    const updateState = (value: VerificationState) => setStoredState({ key: requestKey, value });
    void (async () => {
      try {
        const original = await fetchMedicineCatalogueDetail(originalId, 'official_catalogue', accessToken);
        if (!matchesReportedCatalogueMatch(original, medicine.medicine_match)) {
          if (active) {
            updateState({
              kind: 'insufficient',
              message: 'The result match could not be confirmed against its official source record. No alternative is shown.',
            });
          }
          return;
        }

        const candidateResults = await Promise.allSettled(
          plan.candidateIds.map((id) => fetchMedicineCatalogueDetail(id, 'official_catalogue', accessToken)),
        );
        if (!active) return;

        const candidates: CatalogueMedicineDetail[] = [];
        let failedRequests = 0;
        let withheld = plan.invalidClaimCount;
        for (const result of candidateResults) {
          if (result.status === 'rejected') {
            failedRequests++;
            withheld++;
            continue;
          }
          if (assessSameFormulation(original, result.value).status === 'verified') {
            candidates.push(result.value);
          } else {
            withheld++;
          }
        }
        if (candidates.length > 0) {
          updateState({ kind: 'verified', original, candidates, withheld, retryableWithheld: failedRequests > 0 });
        } else if (failedRequests > 0) {
          updateState({
            kind: 'error',
            message: 'Some catalogue records could not be checked. No alternative is shown until verification succeeds.',
          });
        } else {
          updateState({
            kind: 'insufficient',
            message: 'The proposed records did not have sufficient matching evidence. No alternative is shown.',
          });
        }
      } catch (error: unknown) {
        if (active) updateState({ kind: 'error', message: failureMessage(error) });
      }
    })();

    return () => {
      active = false;
    };
  }, [accessToken, medicine.medicine_match, originalId, plan, requestKey]);

  if (medicine.medicine_match.status !== 'matched') return null;

  return (
    <section className="mt-4 border-t border-[var(--cc-border)]/50 pt-4" aria-labelledby={`alternatives-${medicine.sequence_number}`}>
      <h4 id={`alternatives-${medicine.sequence_number}`} className="font-semibold text-[var(--cc-text)]">
        Same-formulation reference records
      </h4>
      <p className="mt-1 text-xs text-[var(--cc-muted)]">
        Only source-backed records with exact ingredient composition, strength, units, dosage form, salt, route, release, and complete product, manufacturer, and source-record identity are shown.
        This is not a clinical equivalence or substitution assessment.
      </p>
      {state.kind === 'loading' ? (
        <div className="mt-3 grid gap-2" role="status" aria-busy="true">
          <span className="sr-only">Verifying official catalogue records</span>
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : null}
      {state.kind === 'empty' ? (
        <p className="mt-3 text-sm text-[var(--cc-muted)]">
          No verified same-formulation alternatives are available in the current medicine catalogue.
        </p>
      ) : null}
      {state.kind === 'insufficient' ? (
        <p className="mt-3 text-sm text-[var(--cc-muted)]" role="status">{state.message}</p>
      ) : null}
      {state.kind === 'error' ? (
        <div className="mt-3 flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-[var(--cc-danger)]">{state.message}</p>
          <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Retry verification</Button>
        </div>
      ) : null}
      {state.kind === 'verified' ? (
        <div className="mt-3 grid gap-3">
          {state.candidates.map((candidate) => (
            <AlternativeCard key={candidate.id} original={state.original} candidate={candidate} />
          ))}
          {state.withheld > 0 ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--cc-muted)]" role="status">
              <span>{state.withheld} proposed record(s) were withheld because evidence was incomplete or verification failed.</span>
              {state.retryableWithheld ? (
                <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Retry withheld records</Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
