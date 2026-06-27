import type {
  ActivityCategory,
  ActivityQualityTag,
  NormalizedActivity,
  StrategicAlignmentTag,
} from './types.js';

export function classifyFromMdasSignal(input: {
  kind: string;
  title: string;
  summary: string;
  bucket?: string;
  playType?: string;
  changeCategory?: string;
  field?: string;
}): Pick<NormalizedActivity, 'category' | 'strategicTags' | 'qualityTags' | 'customerFacing'> {
  const title = `${input.title} ${input.summary} ${input.field ?? ''}`.toLowerCase();
  const tags: StrategicAlignmentTag[] = ['expand3_portfolio', 'account_activity_visibility'];
  const quality: ActivityQualityTag[] = [];
  let category: ActivityCategory = 'unknown';
  let customerFacing = false;

  if (input.kind === 'meeting') {
    category = title.includes('executive') || title.includes('qbr') || title.includes('ebr')
      ? 'executive_engagement'
      : 'customer_meeting';
    customerFacing = true;
    tags.push('strategic_customer_engagement');
    if (title.includes('renewal') || title.includes('risk')) {
      category = 'renewal_risk_activity';
      tags.push('renewal_risk_prioritization', 'atr_retention');
    }
  } else if (input.kind === 'workshop' || input.kind === 'qbr') {
    category = 'qbr_ebr_prep';
    customerFacing = true;
    tags.push('strategic_customer_engagement', 'six_to_eight_quarter_planning');
  } else if (input.kind === 'cta') {
    category = 'renewal_risk_activity';
    customerFacing = true;
    tags.push('renewal_risk_prioritization', 'atr_retention', 'health_signal_usage', 'strategic_customer_engagement');
    quality.push('proactive');
  } else if (input.kind === 'change_event') {
    if (
      input.changeCategory === 'workshop' ||
      title.includes('workshop') ||
      input.field === 'workshops'
    ) {
      category = 'qbr_ebr_prep';
      customerFacing = true;
      tags.push('strategic_customer_engagement', 'six_to_eight_quarter_planning');
    } else if (title.includes('meeting') || input.field === 'recentMeetings') {
      category = title.includes('executive') || title.includes('qbr') || title.includes('ebr')
        ? 'executive_engagement'
        : 'customer_meeting';
      customerFacing = true;
      tags.push('strategic_customer_engagement');
    } else if (title.includes('task') || input.field === 'gainsightTasks') {
      category = 'customer_follow_up';
      customerFacing = true;
      tags.push('atr_retention', 'strategic_customer_engagement');
    } else {
      category = 'health_signal_review';
      tags.push('health_signal_usage');
      if (title.includes('sentiment') || title.includes('risk')) {
        quality.push('at_risk_account');
        tags.push('renewal_risk_prioritization');
      }
    }
  } else if (input.kind === 'task') {
    category = 'customer_follow_up';
    customerFacing = true;
    tags.push('atr_retention', 'strategic_customer_engagement');
  } else if (input.kind === 'slack') {
    category = 'customer_follow_up';
    customerFacing = true;
    tags.push('strategic_customer_engagement', 'account_activity_visibility', 'expand3_portfolio');
  } else if (input.kind === 'glean_email') {
    category = 'customer_follow_up';
    customerFacing = !title.includes('newsletter') && !title.includes('unsubscribe');
    if (customerFacing) tags.push('strategic_customer_engagement');
  } else if (input.kind === 'account_plan') {
    category = 'account_planning';
    tags.push('six_to_eight_quarter_planning', 'expand3_portfolio');
  }

  if (input.bucket === 'Saveable Risk' || input.bucket === 'Confirmed Churn') {
    quality.push('at_risk_account', 'high_value_account');
    tags.push('atr_retention', 'renewal_risk_prioritization');
  }

  if (input.playType?.includes('engagement') || input.playType?.includes('dark')) {
    quality.push('needs_manager_coaching');
    tags.push('account_activity_visibility');
  }

  if (!customerFacing && category !== 'health_signal_review') {
    quality.push('internal_only');
  }

  return { category, strategicTags: [...new Set(tags)], qualityTags: [...new Set(quality)], customerFacing };
}

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  customer_meeting: 'Customer meeting',
  executive_engagement: 'Executive engagement',
  renewal_risk_activity: 'Renewal risk activity',
  health_signal_review: 'Health signal review',
  account_planning: 'Account planning',
  internal_strategy: 'Internal strategy / planning',
  support_escalation: 'Support escalation',
  customer_follow_up: 'Customer follow-up',
  expansion_growth: 'Expansion / growth motion',
  qbr_ebr_prep: 'QBR / EBR preparation',
  team_coaching: 'Team coaching',
  cross_functional: 'Cross-functional dependency',
  documentation_enablement: 'Documentation / enablement',
  ai_assisted_workflow: 'AI-assisted workflow',
  administrative: 'Administrative / low-signal',
  unknown: 'Unknown / unclassified',
};
