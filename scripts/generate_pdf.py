"""
Chronicle PDF Generator
=======================
Converts markdown content into a styled PDF matching Chronicle's design language.
Uses fpdf2 (pure Python, no system dependencies).

Usage:
    python generate_pdf.py --input content.md --output report.pdf
    python generate_pdf.py --title "Weekly Update" --content "## Summary..."

Requirements:
    pip install fpdf2 markdown
"""

import argparse
import re
import sys
from datetime import datetime

from fpdf import FPDF


# ─── Chronicle PDF Class ──────────────────────────────────────────────────────

class ChroniclePDF(FPDF):
    """Custom PDF with Chronicle styling."""

    def __init__(self):
        super().__init__()
        self.set_auto_page_break(auto=True, margin=20)
        self.add_page()
        self.set_margins(22, 20, 22)

    def header_block(self, title: str, subtitle: str = "", date_str: str = ""):
        """Render the report title block."""
        self.set_font("Helvetica", "B", 20)
        self.set_text_color(15, 23, 42)  # #0F172A
        self.cell(0, 10, title, new_x="LMARGIN", new_y="NEXT")
        if subtitle:
            self.set_font("Helvetica", "", 11)
            self.set_text_color(100, 116, 139)  # #64748B
            self.cell(0, 6, subtitle, new_x="LMARGIN", new_y="NEXT")
        if date_str:
            self.set_font("Helvetica", "", 9)
            self.set_text_color(148, 163, 184)  # #94A3B8
            self.cell(0, 5, date_str, new_x="LMARGIN", new_y="NEXT")
        # Divider line
        self.ln(4)
        self.set_draw_color(226, 232, 240)  # #E2E8F0
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(8)

    def section_heading(self, text: str):
        """Render an H2 section heading with blue underline."""
        self.ln(4)
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(30, 41, 59)  # #1E293B
        self.cell(0, 7, text, new_x="LMARGIN", new_y="NEXT")
        # Blue underline
        self.set_draw_color(59, 130, 246)  # #3B82F6
        self.set_line_width(0.5)
        self.line(self.l_margin, self.get_y(), self.l_margin + self.get_string_width(text) + 4, self.get_y())
        self.set_line_width(0.2)
        self.ln(5)

    def sub_heading(self, text: str):
        """Render an H3 sub-heading."""
        self.ln(2)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(51, 65, 85)  # #334155
        self.cell(0, 6, text, new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def body_text(self, text: str):
        """Render body paragraph text."""
        self.set_font("Helvetica", "", 10)
        self.set_text_color(51, 65, 85)  # #334155
        self.multi_cell(0, 5, text)
        self.ln(2)

    def bullet_item(self, text: str, bold_prefix: str = ""):
        """Render a bullet point with optional bold prefix."""
        self.set_text_color(59, 130, 246)  # Blue bullet
        self.set_font("Helvetica", "", 10)
        x = self.get_x()
        self.cell(5, 5, '  >')  # bullet character
        self.set_text_color(51, 65, 85)  # #334155
        if bold_prefix:
            self.set_font("Helvetica", "B", 10)
            self.write(5, bold_prefix)
            self.set_font("Helvetica", "", 10)
            remaining = text[len(bold_prefix):] if text.startswith(bold_prefix) else " " + text
            self.write(5, remaining)
        else:
            self.write(5, text)
        self.ln(6)

    def star_bullet(self, text: str, bold_prefix: str = ""):
        """Render a starred/accomplishment bullet."""
        self.set_text_color(245, 158, 11)  # Amber star
        self.set_font("Helvetica", "", 10)
        self.cell(5, 5, '[*]')  # star character
        self.set_text_color(51, 65, 85)
        if bold_prefix:
            self.set_font("Helvetica", "B", 10)
            self.write(5, bold_prefix)
            self.set_font("Helvetica", "", 10)
            remaining = text[len(bold_prefix):] if text.startswith(bold_prefix) else " " + text
            self.write(5, remaining)
        else:
            self.write(5, text)
        self.ln(6)

    def divider(self):
        """Render a horizontal divider."""
        self.ln(4)
        self.set_draw_color(226, 232, 240)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(6)

    def footer(self):
        """Page footer with page number."""
        self.set_y(-15)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(148, 163, 184)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")


# ─── Markdown to PDF Renderer ─────────────────────────────────────────────────

def render_markdown_to_pdf(pdf: ChroniclePDF, content: str):
    """Parse markdown and render to the PDF using Chronicle styling."""
    # Sanitize unicode characters that Helvetica can't handle
    content = content.replace('\u2014', '--').replace('\u2013', '-')
    content = content.replace('\u2192', '->').replace('\u2190', '<-')
    content = content.replace('\u2713', '[ok]').replace('\u2717', '[x]')
    content = content.replace('\u2b50', '[*]').replace('\u2605', '[*]')
    content = content.replace('\u2022', '-').replace('\u2019', "'").replace('\u2018', "'")
    content = content.replace('\u201c', '"').replace('\u201d', '"')
    content = content.replace('\u2026', '...')
    # Strip any remaining non-latin1 characters
    content = content.encode('latin-1', errors='replace').decode('latin-1')

    lines = content.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]

        # H1
        if line.startswith('# '):
            pdf.section_heading(line[2:].strip())
        # H2
        elif line.startswith('## '):
            pdf.section_heading(line[3:].strip())
        # H3
        elif line.startswith('### '):
            pdf.sub_heading(line[4:].strip())
        # Horizontal rule
        elif line.strip() in ('---', '***', '___'):
            pdf.divider()
        # Star bullet (⭐)
        elif line.strip().startswith('- ⭐') or line.strip().startswith('- **⭐'):
            text = line.strip()[2:].strip()
            # Extract bold prefix
            bold_match = re.match(r'\*\*(.+?)\*\*(.*)$', text)
            if bold_match:
                pdf.star_bullet(bold_match.group(1) + bold_match.group(2), bold_match.group(1))
            else:
                text = text.replace('⭐ ', '').replace('⭐', '')
                pdf.star_bullet(text)
        # Regular bullet
        elif line.strip().startswith('- '):
            text = line.strip()[2:]
            # Extract bold prefix
            bold_match = re.match(r'\*\*(.+?)\*\*(.*)$', text)
            if bold_match:
                pdf.bullet_item(bold_match.group(1) + bold_match.group(2), bold_match.group(1))
            else:
                pdf.bullet_item(text)
        # Italic line (footer/metadata)
        elif line.strip().startswith('*') and line.strip().endswith('*') and not line.strip().startswith('**'):
            pdf.set_font("Helvetica", "I", 9)
            pdf.set_text_color(148, 163, 184)
            pdf.cell(0, 5, line.strip().strip('*'), new_x="LMARGIN", new_y="NEXT")
            pdf.ln(2)
        # Empty line
        elif not line.strip():
            pdf.ln(2)
        # Regular text
        else:
            # Handle inline bold
            clean = re.sub(r'\*\*(.+?)\*\*', r'\1', line)
            pdf.body_text(clean)

        i += 1


# ─── Main ─────────────────────────────────────────────────────────────────────

def generate_pdf(content: str, output_path: str, title: str = None, subtitle: str = None):
    pdf = ChroniclePDF()

    if title:
        date_str = f"Generated {datetime.now().strftime('%B %d, %Y at %I:%M %p')}"
        pdf.header_block(title, subtitle or "", date_str)

    render_markdown_to_pdf(pdf, content)
    pdf.output(output_path)
    print(f"PDF generated: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Chronicle PDF Generator")
    parser.add_argument("--input", "-i", help="Input markdown file")
    parser.add_argument("--output", "-o", default="report.pdf", help="Output PDF path")
    parser.add_argument("--title", "-t", help="Report title")
    parser.add_argument("--subtitle", "-s", help="Subtitle")
    parser.add_argument("--content", "-c", help="Direct markdown content")

    args = parser.parse_args()

    if args.content:
        content = args.content
    elif args.input:
        with open(args.input, 'r', encoding='utf-8') as f:
            content = f.read()
    elif not sys.stdin.isatty():
        content = sys.stdin.read()
    else:
        print("Error: Provide content via --input, --content, or stdin")
        sys.exit(1)

    generate_pdf(content, args.output, title=args.title, subtitle=args.subtitle)


if __name__ == "__main__":
    main()
