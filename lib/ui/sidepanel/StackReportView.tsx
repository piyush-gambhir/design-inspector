// Stack report rendering (PRD 13). Used by the Stack tab and inlined at the
// end of the Summary tab.
//
// Weak hints stay collapsed and never read as detections. "Not detected" is
// stated as insufficient evidence, not as absence.
import type { StackCategory, StackEvidence, StackReport } from '@/lib/contracts';
import {
  Collapsible,
  ConfidenceBadge,
  EmptyState,
  GroupHeading,
  StatusLine,
} from '@/lib/ui/shared/components';

const CATEGORY_LABELS: Record<StackCategory, string> = {
  framework: 'Frameworks',
  'builder-cms': 'Builders and CMS',
  styling: 'Styling',
  'motion-3d': 'Motion and 3D',
  'font-provider': 'Font providers',
  'infra-analytics': 'Infrastructure and analytics',
};

const CATEGORY_ORDER: StackCategory[] = [
  'framework',
  'builder-cms',
  'styling',
  'motion-3d',
  'font-provider',
  'infra-analytics',
];

const EVIDENCE_LABELS: Record<StackEvidence['kind'], string> = {
  'script-url': 'Script URL',
  'stylesheet-url': 'Stylesheet URL',
  'dom-marker': 'DOM marker',
  meta: 'Meta tag',
  global: 'Runtime global',
  header: 'Response header',
  'link-url': 'Link URL',
};

function EvidenceList({ evidence }: { evidence: StackEvidence[] }) {
  if (evidence.length === 0) return <StatusLine>No evidence recorded.</StatusLine>;
  return (
    <ul className="grid gap-1">
      {evidence.map((item, index) => (
        <li key={`${item.kind}-${index}`} className="text-[12px]">
          <span className="text-muted-foreground">{EVIDENCE_LABELS[item.kind]}: </span>
          <span className="font-mono break-all">{item.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function StackReportView({ report }: { report: StackReport | null }) {
  if (!report) {
    return (
      <EmptyState
        title="No stack report yet"
        body="Run a page scan or open the Stack tab to gather evidence from this page."
      />
    );
  }

  const grouped = CATEGORY_ORDER.map(category => ({
    category,
    detections: report.detections.filter(detection => detection.category === category),
  })).filter(group => group.detections.length > 0);

  return (
    <div className="grid gap-3">
      {grouped.length === 0 ? (
        <EmptyState
          title="No confident evidence found"
          body="This does not prove a technology is absent. Let the page finish loading and refresh the report, or read the weak hints below and judge them yourself."
        />
      ) : (
        grouped.map(group => (
          <div key={group.category} className="grid gap-1.5">
            <GroupHeading count={group.detections.length}>
              {CATEGORY_LABELS[group.category]}
            </GroupHeading>
            {group.detections.map(detection => (
              <div key={detection.id} className="rounded-[8px] bg-surface-2 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium">
                    {detection.name}
                    {detection.version ? (
                      <span className="ml-1 font-mono text-[12px] text-muted-foreground">
                        {detection.version}
                      </span>
                    ) : null}
                  </span>
                  <ConfidenceBadge confidence={detection.confidence} />
                </div>
                <Collapsible summary={`Evidence (${detection.evidence.length})`}>
                  <EvidenceList evidence={detection.evidence} />
                </Collapsible>
              </div>
            ))}
          </div>
        ))
      )}

      {report.hints.length > 0 ? (
        <Collapsible summary={`Weak hints (${report.hints.length})`}>
          <div className="grid gap-2">
            <StatusLine>
              Hints are not detections. They are shown so you can judge them yourself.
            </StatusLine>
            {report.hints.map((hint, index) => (
              <div key={`${hint.name}-${index}`} className="rounded-[8px] bg-surface-2 p-2">
                <p className="text-[12px] font-medium">{hint.name}</p>
                <EvidenceList evidence={hint.evidence} />
              </div>
            ))}
          </div>
        </Collapsible>
      ) : null}

      <StatusLine>
        Scope: {report.scope}. Observed at {report.observedAt}.
      </StatusLine>
    </div>
  );
}
