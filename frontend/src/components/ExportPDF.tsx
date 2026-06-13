/**
 * PDF Export — renders a ParsedExport as a downloadable PDF using @react-pdf/renderer.
 * Executive-grade styling: Helvetica, slate palette, signal blocks, fixed footer.
 *
 * Program-aware enhancements (R22.1–R22.4):
 *  - Program names rendered as prominent top-level section headers
 *  - Page breaks between program sections in multi-program exports
 *  - Operational Cadence rendered as formatted tables with completion rates
 *  - Adherence badges (green/yellow/red) next to completion rates
 */
import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer';
import { createElement } from 'react';
import type { ParsedExport, ExportSection, ExportItem, CadenceRow } from '../utils/smartParse';

/* ── Badge color thresholds — WCAG AA compliant on white ── */
const BADGE_GREEN = '#166534';
const BADGE_YELLOW = '#854d0e';
const BADGE_RED = '#b91c1c';

function badgeColor(rate: number): string {
  if (rate > 90) return BADGE_GREEN;
  if (rate >= 70) return BADGE_YELLOW;
  return BADGE_RED;
}

/* ── Styles ── */
const BRAND = {
  primary: '#3B82F6',
  accent: '#F59E0B',
  text: '#1E293B',
  textSecondary: '#475569',
  muted: '#64748B',
  divider: '#E2E8F0',
  green: '#166534',
};

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 60, backgroundColor: '#ffffff', fontFamily: 'Helvetica', fontSize: 10, color: BRAND.text },
  title: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: BRAND.text, marginBottom: 2 },
  subtitle: { fontSize: 10, color: BRAND.muted, marginBottom: 2 },
  dateRange: { fontSize: 9, color: BRAND.muted, marginBottom: 4 },
  accentLine: { height: 2, backgroundColor: BRAND.primary, marginTop: 6, marginBottom: 20 },
  sectionHeading: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: BRAND.text, marginBottom: 8, marginTop: 16 },
  programHeading: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: BRAND.text, marginBottom: 4, marginTop: 8 },
  programAccent: { height: 2, backgroundColor: BRAND.primary, marginBottom: 14 },
  itemBlock: { marginBottom: 10, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: BRAND.divider },
  itemBlockAccent: { marginBottom: 10, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: BRAND.green, backgroundColor: '#f0f7f2', padding: 8, borderRadius: 2 },
  itemBlockPinned: { marginBottom: 10, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: BRAND.accent, backgroundColor: '#FFFBEB', padding: 8, borderRadius: 2 },
  itemTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: BRAND.text, marginBottom: 2 },
  itemProject: { fontSize: 9, color: BRAND.textSecondary },
  itemDesc: { fontSize: 9, color: BRAND.textSecondary, marginTop: 2 },
  itemMetrics: { fontSize: 9, color: BRAND.green, marginTop: 2 },
  itemImpact: { fontSize: 9, color: BRAND.textSecondary, marginTop: 2 },
  reviewNote: { fontSize: 8, color: BRAND.primary, fontStyle: 'italic', marginTop: 3, paddingLeft: 6, borderLeftWidth: 1, borderLeftColor: BRAND.primary },
  sessionNotes: { fontSize: 9, color: BRAND.textSecondary, marginTop: 4, whiteSpace: 'pre-wrap' as unknown as undefined },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: BRAND.muted },
  cadenceContainer: { marginTop: 12, marginBottom: 12 },
  cadenceTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: BRAND.text, marginBottom: 6 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BRAND.divider, paddingVertical: 4 },
  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: BRAND.text, paddingVertical: 4, backgroundColor: '#F9FAFB' },
  tableColName: { width: '45%', fontSize: 9, color: BRAND.text },
  tableColRate: { width: '20%', fontSize: 9, color: BRAND.text, textAlign: 'center' },
  tableColCount: { width: '20%', fontSize: 9, color: BRAND.text, textAlign: 'center' },
  tableColBadge: { width: '15%', textAlign: 'center' },
  tableHeaderText: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: BRAND.textSecondary },
  badge: { fontSize: 8, fontFamily: 'Helvetica-Bold', borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  skipNote: { fontSize: 7, color: BRAND.muted, paddingLeft: 4, marginTop: 1 },
});

/* ── Cadence Table Renderer (R22.3, R22.4) ── */
function CadenceTable({ rows }: { rows: CadenceRow[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <View style={s.cadenceContainer} wrap={false}>
      <Text style={s.cadenceTitle}>Operational Cadence</Text>
      {/* Header row */}
      <View style={s.tableHeaderRow}>
        <View style={s.tableColName}><Text style={s.tableHeaderText}>Item</Text></View>
        <View style={s.tableColCount}><Text style={s.tableHeaderText}>Completed</Text></View>
        <View style={s.tableColRate}><Text style={s.tableHeaderText}>Rate</Text></View>
        <View style={s.tableColBadge}><Text style={s.tableHeaderText}>Status</Text></View>
      </View>
      {/* Data rows */}
      {rows.map((row, i) => {
        const color = badgeColor(row.rate);
        return (
          <View key={`cadence-${i}`}>
            <View style={s.tableRow}>
              <View style={s.tableColName}><Text>{row.name}</Text></View>
              <View style={s.tableColCount}><Text>{row.completed}/{row.total}</Text></View>
              <View style={s.tableColRate}><Text>{row.rate}%</Text></View>
              <View style={s.tableColBadge}>
                <Text style={[s.badge, { color: '#ffffff', backgroundColor: color }]}>
                  {row.rate > 90 ? '●' : row.rate >= 70 ? '◐' : '○'}
                </Text>
              </View>
            </View>
            {(row.skipped ?? 0) > 0 && (
              <Text style={s.skipNote}>
                {row.skipped} skipped{row.skipReasons ? ` (${row.skipReasons})` : ''}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

/* ── Item Renderer ── */
function PDFItem({ item, accent }: { item: ExportItem; accent?: boolean }) {
  if (!item.enabled) return null;
  const isPinned = item.title.startsWith('★');
  const blockStyle = isPinned ? s.itemBlockPinned : accent ? s.itemBlockAccent : s.itemBlock;
  const showProject = item.projectName && item.projectName !== item.title;
  return (
    <View style={blockStyle} wrap={false}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <Text style={{ ...s.itemTitle, color: isPinned ? '#92400E' : BRAND.text }}>{item.title}</Text>
        {showProject && <Text style={s.itemProject}>({item.projectName})</Text>}
      </View>
      {item.description && <Text style={s.itemDesc}>{item.description}</Text>}
      {item.metrics && <Text style={s.itemMetrics}>Metrics: {item.metrics}</Text>}
      {item.impact && <Text style={s.itemImpact}>Impact: {item.impact}</Text>}
      {item.reviewNote && <Text style={s.reviewNote}>{item.reviewNote}</Text>}
    </View>
  );
}

/* ── Section Renderer ── */
function PDFSection({ sec }: { sec: ExportSection }) {
  if (!sec.enabled) return null;
  const enabledItems = sec.items.filter(i => i.enabled);
  const hasCadence = sec.cadenceData && sec.cadenceData.length > 0;
  if (enabledItems.length === 0 && !hasCadence) return null;
  const isAccent = sec.id === 'highlight' || sec.id === 'on-track';

  /* Program section: prominent header (R22.1, R22.2) */
  if (sec.isProgramSection) {
    return (
      <View>
        <Text style={s.programHeading}>{sec.heading}</Text>
        <View style={s.programAccent} />
        {enabledItems.map((item, i) => (
          <PDFItem key={`${item.entityType}-${item.id}-${i}`} item={item} accent={isAccent} />
        ))}
        {hasCadence && <CadenceTable rows={sec.cadenceData!} />}
      </View>
    );
  }

  return (
    <View wrap={false}>
      <Text style={s.sectionHeading}>{sec.heading}</Text>
      {enabledItems.map((item, i) => (
        <PDFItem key={`${item.entityType}-${item.id}-${i}`} item={item} accent={isAccent} />
      ))}
      {hasCadence && <CadenceTable rows={sec.cadenceData!} />}
    </View>
  );
}

/* ── Document Component ── */
function ExportPDFDocument({ data, userName }: { data: ParsedExport; userName: string }) {
  const sortedSections = [...data.sections].sort((a, b) => a.order - b.order);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{data.title}</Text>
        <Text style={s.subtitle}>{data.subtitle}</Text>
        <Text style={s.dateRange}>{data.dateRange}</Text>
        <View style={s.accentLine} />

        {sortedSections.map(sec => {
          return (
            <PDFSection key={sec.id} sec={sec} />
          );
        })}

        {data.sessionNotes && (
          <View style={{ marginTop: 16 }}>
            <Text style={s.sectionHeading}>Session Notes</Text>
            <Text style={s.sessionNotes}>{data.sessionNotes}</Text>
          </View>
        )}

        <View style={s.footer} fixed>
          <Text style={s.footerText}>{userName || 'Chronicle'}</Text>
          <Text style={s.footerText}>Generated by Chronicle · {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/* ── Download Trigger ── */
export async function downloadPDF(data: ParsedExport, userName: string, filename?: string) {
  try {
    // Smart filename: Brandon_Hill-Rogers_Report_2026-04-07_to_2026-04-13.pdf
    const safeName = userName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
    const dates = data.dateRange.split('—').map(s => s.trim());
    const start = dates[0] || '';
    const end = dates[1] || '';
    const smartFilename = filename ?? `${safeName}_Report_${start}_to_${end}.pdf`.replace(/\s+/g, '_');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = createElement(ExportPDFDocument, { data, userName }) as any;
    const blob = await pdf(doc).toBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = smartFilename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('PDF generation failed:', err);
    alert('PDF download failed. Please try again or use Copy for Export instead.');
  }
}

export default ExportPDFDocument;
