import type { ExchangeRecord, FinalEvaluation } from './agent/types';

export function buildReportText(params: {
  role: string;
  evaluation: FinalEvaluation;
  exchanges: ExchangeRecord[];
}): string {
  const { role, evaluation, exchanges } = params;
  const lines: string[] = [];

  lines.push(`Sage Interview Report — ${role}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Readiness: ${evaluation.readinessRating}`);
  lines.push(`Overall Score: ${evaluation.overallScore}/10`);
  lines.push('');
  lines.push('Summary');
  lines.push(evaluation.summary);
  lines.push('');

  lines.push('Area Scores');
  evaluation.areaScores.forEach((a) => {
    lines.push(`- ${a.areaName}: ${a.score}/10 — ${a.feedback}`);
  });
  lines.push('');

  if (evaluation.strengths?.length) {
    lines.push('Strengths');
    evaluation.strengths.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }

  if (evaluation.weakMoments?.length) {
    lines.push('Weak Moments');
    evaluation.weakMoments.forEach((m) => {
      lines.push(`Q: ${m.question}`);
      lines.push(`A: ${m.answer}`);
      lines.push(`Why weak: ${m.whyWeak}`);
      lines.push(`How to improve: ${m.howToImprove}`);
      lines.push('');
    });
  }

  if (evaluation.areasForImprovement?.length) {
    lines.push('Areas for Improvement');
    evaluation.areasForImprovement.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }

  lines.push('Top Priority');
  lines.push(evaluation.recommendation);
  lines.push('');

  lines.push('─'.repeat(60));
  lines.push('Full Transcript');
  lines.push('─'.repeat(60));
  exchanges.forEach((e, i) => {
    lines.push('');
    lines.push(`Q${i + 1}: ${e.question}`);
    lines.push(`A${i + 1}: ${e.answer}`);
  });

  return lines.join('\n');
}

export function downloadReport(params: {
  role: string;
  evaluation: FinalEvaluation;
  exchanges: ExchangeRecord[];
}): void {
  const text = buildReportText(params);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const safeRole = params.role
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'interview';

  const a = document.createElement('a');
  a.href = url;
  a.download = `sage-interview-${safeRole}-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
