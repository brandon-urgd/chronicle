/**
 * ReportPreview — WYSIWYG rich preview that mirrors the PDF layout.
 * Renders ParsedExport as styled HTML with Chronicle branding.
 */
import type { ParsedExport, ExportSection, ExportItem, CadenceRow } from '../utils/smartParse';

const COLORS = {
  primary: '#3B82F6',
  accent: '#F59E0B',
  text: '#1E293B',
  textSecondary: '#475569',
  muted: '#64748B',
  divider: '#E2E8F0',
  background: '#FFFFFF',
  pinnedBg: '#FFFBEB',
  pinnedBorder: '#F59E0B',
  green: '#166534',
};

const containerStyle: React.CSSProperties = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  color: COLORS.text, background: COLORS.background,
  border: `1px solid ${COLORS.divider}`, borderRadius: '8px',
  padding: '40px', maxHeight: '600px', overflowY: 'auto',
  lineHeight: 1.7, fontSize: '14px',
};

function Header({ data }: { data: ParsedExport & { userName?: string; userRole?: string; userOrg?: string } }) {
  return (
    <div style={{ marginBottom: '28px', borderBottom: `2px solid ${COLORS.primary}`, paddingBottom: '20px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, color: COLORS.text, margin: '0 0 4px', letterSpacing: '-0.3px' }}>
        {data.title}
      </h1>
      {data.subtitle && <div style={{ fontSize: '14px', color: COLORS.textSecondary, marginBottom: '4px' }}>{data.subtitle}</div>}
      <div style={{ fontSize: '13px', color: COLORS.muted }}>{data.dateRange}</div>
    </div>
  );
}

function CadenceTable({ rows }: { rows: CadenceRow[] }) {
  if (!rows || rows.length === 0) return null;
  const badgeStyle = (rate: number): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: '10px',
    fontSize: '11px', fontWeight: 600, color: '#fff',
    background: rate > 90 ? COLORS.green : rate >= 70 ? '#854d0e' : '#b91c1c',
  });
  return (
    <div style={{ margin: '12px 0 16px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: COLORS.text, marginBottom: '8px' }}>Operational Cadence</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${COLORS.divider}` }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: COLORS.muted, fontWeight: 600 }}>Item</th>
            <th style={{ textAlign: 'center', padding: '6px 8px', color: COLORS.muted, fontWeight: 600 }}>Completed</th>
            <th style={{ textAlign: 'center', padding: '6px 8px', color: COLORS.muted, fontWeight: 600 }}>Rate</th>
            <th style={{ textAlign: 'center', padding: '6px 8px', color: COLORS.muted, fontWeight: 600 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${COLORS.divider}` }}>
              <td style={{ padding: '6px 8px', color: COLORS.text }}>{row.name}</td>
              <td style={{ padding: '6px 8px', textAlign: 'center', color: COLORS.textSecondary }}>{row.completed}/{row.total}</td>
              <td style={{ padding: '6px 8px', textAlign: 'center', color: COLORS.textSecondary }}>{row.rate}%</td>
              <td style={{ padding: '6px 8px', textAlign: 'center' }}><span style={badgeStyle(row.rate)}>{row.rate > 90 ? '●' : row.rate >= 70 ? '◐' : '○'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemRow({ item }: { item: ExportItem }) {
  if (!item.enabled) return null;
  const isPinned = item.title.startsWith('★');
  return (
    <div style={{
      padding: '8px 12px', marginBottom: '6px', borderRadius: '4px',
      borderLeft: isPinned ? `3px solid ${COLORS.pinnedBorder}` : `2px solid ${COLORS.divider}`,
      background: isPinned ? COLORS.pinnedBg : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: isPinned ? '#92400E' : COLORS.text }}>{item.title}</span>
        {item.projectName && item.projectName !== item.title && (
          <span style={{ fontSize: '11px', color: COLORS.muted }}>({item.projectName})</span>
        )}
        {item.date && <span style={{ fontSize: '11px', color: COLORS.muted, marginLeft: 'auto', flexShrink: 0 }}>{item.date}</span>}
      </div>
      {item.description && <div style={{ fontSize: '12px', color: COLORS.textSecondary, marginTop: '3px' }}>{item.description}</div>}
      {item.metrics && <div style={{ fontSize: '11px', color: COLORS.green, marginTop: '3px', paddingLeft: '12px' }}>Metrics: {item.metrics}</div>}
      {item.impact && <div style={{ fontSize: '11px', color: COLORS.textSecondary, marginTop: '2px', paddingLeft: '12px' }}>Impact: {item.impact}</div>}
      {item.reviewNote && (
        <div style={{ fontSize: '11px', color: COLORS.primary, fontStyle: 'italic', marginTop: '4px', paddingLeft: '12px', borderLeft: `2px solid ${COLORS.primary}` }}>
          {item.reviewNote}
        </div>
      )}
    </div>
  );
}

function SectionBlock({ section }: { section: ExportSection }) {
  if (!section.enabled) return null;
  const enabledItems = section.items.filter(i => i.enabled);
  const hasCadence = section.cadenceData && section.cadenceData.length > 0;
  if (enabledItems.length === 0 && !hasCadence) return null;

  return (
    <div style={{ marginBottom: '24px' }}>
      {section.isProgramSection ? (
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: COLORS.text, margin: '0 0 4px', paddingBottom: '6px', borderBottom: `2px solid ${COLORS.primary}` }}>
          {section.heading}
        </h2>
      ) : (
        <h3 style={{ fontSize: '15px', fontWeight: 600, color: COLORS.textSecondary, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {section.heading}
        </h3>
      )}
      {enabledItems.map((item, i) => <ItemRow key={`${item.entityType}-${item.id}-${i}`} item={item} />)}
      {hasCadence && <CadenceTable rows={section.cadenceData!} />}
    </div>
  );
}

export default function ReportPreview({ data }: { data: ParsedExport }) {
  const sortedSections = [...data.sections].sort((a, b) => a.order - b.order);
  return (
    <div style={containerStyle}>
      <Header data={data as ParsedExport & { userName?: string; userRole?: string; userOrg?: string }} />
      {sortedSections.map(sec => <SectionBlock key={sec.id} section={sec} />)}
      <div style={{ marginTop: '32px', paddingTop: '12px', borderTop: `1px solid ${COLORS.divider}`, display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: COLORS.muted }}>
        <span>Generated by Chronicle</span>
        <span>{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
    </div>
  );
}

/** Generate HTML string for rich clipboard copy */
export function generateReportHTML(data: ParsedExport): string {
  const sorted = [...data.sections].sort((a, b) => a.order - b.order);
  let html = `<div style="font-family: Calibri, Arial, sans-serif; color: #1E293B; line-height: 1.6;">`;
  html += `<h1 style="font-size: 20px; margin: 0 0 4px; color: #1E293B;">${data.title}</h1>`;
  if (data.subtitle) html += `<p style="font-size: 13px; color: #475569; margin: 0 0 2px;">${data.subtitle}</p>`;
  html += `<p style="font-size: 12px; color: #64748B; margin: 0 0 16px;">${data.dateRange}</p>`;
  html += `<hr style="border: none; border-top: 2px solid #3B82F6; margin: 0 0 16px;">`;

  for (const sec of sorted) {
    if (!sec.enabled) continue;
    const items = sec.items.filter(i => i.enabled);
    if (items.length === 0) continue;
    const tag = sec.isProgramSection ? 'h2' : 'h3';
    const size = sec.isProgramSection ? '16px' : '14px';
    html += `<${tag} style="font-size: ${size}; color: #1E293B; margin: 16px 0 8px;">${sec.heading}</${tag}>`;
    html += `<ul style="margin: 0 0 12px; padding-left: 20px;">`;
    for (const item of items) {
      const isPinned = item.title.startsWith('★');
      const style = isPinned ? 'font-weight: 600; color: #92400E;' : 'font-weight: 600;';
      html += `<li style="margin-bottom: 6px;"><span style="${style}">${item.title}</span>`;
      if (item.projectName && item.projectName !== item.title) html += ` <span style="font-size: 12px; color: #64748B;">(${item.projectName})</span>`;
      if (item.description) html += `<br><span style="font-size: 12px; color: #475569;">${item.description}</span>`;
      if (item.metrics) html += `<br><span style="font-size: 11px; color: #166534;">Metrics: ${item.metrics}</span>`;
      html += `</li>`;
    }
    html += `</ul>`;
  }
  html += `</div>`;
  return html;
}
