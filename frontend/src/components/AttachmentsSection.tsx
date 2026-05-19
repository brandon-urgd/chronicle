import { useState } from 'react';

/* ── Types ── */
export interface Attachment {
  id: number;
  parent_type: string;
  parent_id: number;
  filename: string;
  original_name: string;
  file_size: number;
  mime_type: string | null;
  created_at: string;
}

interface AttachmentsSectionProps {
  attachments: Attachment[];
  parentType: string;
  parentId: number;
  onAttachmentsChanged: () => void;
}

/* ── Helpers ── */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── Shared inline styles ── */

const btnDanger: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  color: 'var(--accent-danger)',
  border: '1px solid var(--accent-danger)',
  borderRadius: '6px',
  fontSize: '12px',
  cursor: 'pointer',
};

export default function AttachmentsSection({ attachments, parentType, parentId, onAttachmentsChanged }: AttachmentsSectionProps) {
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('parent_type', parentType);
      formData.append('parent_id', String(parentId));
      const res = await fetch('/api/attachments', { method: 'POST', body: formData });
      if (res.ok) onAttachmentsChanged();
    } catch { /* ignore */ }
    finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function deleteAttachment(id: number) {
    if (!confirm('Remove this attachment?')) return;
    try {
      await fetch(`/api/attachments/${id}`, { method: 'DELETE' });
      onAttachmentsChanged();
    } catch { /* ignore */ }
  }

  return (
    <div>
      <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--accent-primary)' }}>Attachments</h4>
      {attachments.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 0 8px' }}>No attachments.</p>
      )}
      {attachments.map(att => (
        <div key={att.id} style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '6px 12px', background: 'var(--input-bg)', borderRadius: '8px', marginBottom: '4px',
        }}>
          <a
            href={`/api/attachments/${att.id}/download`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ flex: 1, color: 'var(--accent-primary)', fontSize: '13px', textDecoration: 'none' }}
          >
            {att.original_name}
          </a>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatFileSize(att.file_size)}</span>
          <button style={btnDanger} onClick={() => deleteAttachment(att.id)}>×</button>
        </div>
      ))}

      {/* Upload */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
        <input type="file" onChange={handleUpload} disabled={uploading} style={{ fontSize: '13px', color: 'var(--text-primary)' }} />
        {uploading && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Uploading…</span>}
      </div>
    </div>
  );
}
