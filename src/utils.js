export function bmi(weightKg, heightCm) {
  const meters = Number(heightCm) / 100;
  if (!meters || !weightKg) return 0;
  return round1(Number(weightKg) / (meters * meters));
}

export function bmiCategory(value) {
  if (value < 18.5) return '偏瘦';
  if (value < 24) return '正常';
  if (value < 28) return '超重';
  return '肥胖';
}

export function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

export function toNumberOrNull(value) {
  if (value === '' || value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function daysUntil(dateText) {
  if (!dateText) return null;
  const today = new Date();
  const target = new Date(`${dateText}T00:00:00`);
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today) / 86400000);
}

export function completionRateFromSets(sets) {
  if (!sets.length) return 0;
  const done = sets.filter((set) => Number(set.completed) === 1).length;
  return round1((done / sets.length) * 100);
}

export function goalSummary(goal, latestHealth) {
  if (!goal) return null;
  const currentWeight = latestHealth?.weight_kg ?? null;
  const currentWaist = latestHealth?.waist_cm ?? null;
  const weightGap = currentWeight != null && goal.target_weight_kg != null
    ? round1(currentWeight - goal.target_weight_kg)
    : null;
  const waistGap = currentWaist != null && goal.target_waist_cm != null
    ? round1(currentWaist - goal.target_waist_cm)
    : null;

  let progressPercent = null;
  if (goal.start_weight_kg != null && goal.target_weight_kg != null && currentWeight != null) {
    const total = goal.start_weight_kg - goal.target_weight_kg;
    const done = goal.start_weight_kg - currentWeight;
    progressPercent = total === 0 ? 100 : Math.max(0, Math.min(100, round1((done / total) * 100)));
  }

  return {
    weight_gap_kg: weightGap,
    waist_gap_cm: waistGap,
    progress_percent: progressPercent,
    days_left: daysUntil(goal.target_date)
  };
}
