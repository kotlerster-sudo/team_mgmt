/**
 * Types shared by the validation rulebook and the runner.
 * The wizard's Step 2 discipline: deterministic checks only. No LLM
 * consumes these types (the compliance-doc LLM validator writes into
 * DD before the runner reads it, so its output is just data by then).
 */

import type { PartnerData } from '../schema';
import type { AssemblyRow } from '../repo';

export type RuleStatus = 'pass' | 'warn' | 'fail' | 'na';

export type RuleCategory =
  | 'math'
  | 'statutory'
  | 'governance'
  | 'beneficiary'
  | 'renewal'
  | 'coverage';

export type RuleContext = {
  assembly: AssemblyRow;
  partner: PartnerData;
  /** Raw DD JSONB (untyped — rules access via optional chaining). */
  dd: Record<string, unknown> | null;
  /** Reserved for Phase 3: budget snapshot from assessment_budget_snapshot. */
  budget: Record<string, unknown> | null;
};

export type RuleCheckResult = {
  status: RuleStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type Rule = {
  id: string;
  label: string;
  category: RuleCategory;
  check: (ctx: RuleContext) => RuleCheckResult;
};

export type RuleResult = RuleCheckResult & {
  rule_id: string;
  label: string;
  category: RuleCategory;
};

export type ValidationAck = {
  ack_by: string;
  ack_at: string;
  note?: string;
};
