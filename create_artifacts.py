import argparse
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def slugify(value, suffix):
    value = re.sub(r"[\\/:*?\"<>|]+", "-", value or "study-artifact")
    value = re.sub(r"\s+", " ", value).strip().strip(".")
    value = value.strip("- ")
    return f"{value or 'study-artifact'}{suffix}"


def default_output_path(title, suffix):
    output_dir = Path.cwd() / "courseware-output"
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir / slugify(title, suffix)


def iter_markdown_blocks(markdown):
    in_code = False
    code_lines = []
    code_lang = ""
    for raw_line in (markdown or "").splitlines():
        line = raw_line.rstrip()
        if line.strip().startswith("```"):
            if in_code:
                yield {"type": "code", "language": code_lang, "text": "\n".join(code_lines)}
                in_code = False
                code_lines = []
                code_lang = ""
            else:
                in_code = True
                code_lang = line.strip().strip("`").strip()
            continue
        if in_code:
            code_lines.append(line)
            continue
        yield {"type": "line", "text": line}
    if in_code and code_lines:
        yield {"type": "code", "language": code_lang, "text": "\n".join(code_lines)}


def configure_doc(doc):
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Inches, Pt, RGBColor

    section = doc.sections[0]
    section.top_margin = Inches(0.8)
    section.bottom_margin = Inches(0.8)
    section.left_margin = Inches(0.85)
    section.right_margin = Inches(0.85)

    styles = doc.styles
    styles["Normal"].font.name = "Arial"
    styles["Normal"].font.size = Pt(10.5)
    styles["Normal"].paragraph_format.space_after = Pt(6)
    styles["Normal"].paragraph_format.line_spacing = 1.15

    for name, size, color in [
        ("Heading 1", 18, RGBColor(31, 78, 121)),
        ("Heading 2", 14, RGBColor(47, 84, 150)),
        ("Heading 3", 12, RGBColor(68, 68, 68)),
    ]:
        style = styles[name]
        style.font.name = "Arial"
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = color
        style.paragraph_format.space_before = Pt(10)
        style.paragraph_format.space_after = Pt(4)

    title_style = styles.add_style("Study Title", 1)
    title_style.font.name = "Arial"
    title_style.font.size = Pt(24)
    title_style.font.bold = True
    title_style.font.color.rgb = RGBColor(31, 78, 121)
    title_style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_style.paragraph_format.space_after = Pt(6)

    subtitle_style = styles.add_style("Study Subtitle", 1)
    subtitle_style.font.name = "Arial"
    subtitle_style.font.size = Pt(11)
    subtitle_style.font.color.rgb = RGBColor(89, 89, 89)
    subtitle_style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    subtitle_style.paragraph_format.space_after = Pt(14)

    code_style = styles.add_style("Code Block", 1)
    code_style.font.name = "Consolas"
    code_style.font.size = Pt(8.5)
    code_style.paragraph_format.left_indent = Inches(0.25)
    code_style.paragraph_format.space_before = Pt(4)
    code_style.paragraph_format.space_after = Pt(6)


def add_markdown_to_doc(doc, markdown):
    from docx.shared import Pt

    pending_number = 1
    for block in iter_markdown_blocks(markdown):
        if block["type"] == "code":
            for line in block["text"].splitlines() or [""]:
                p = doc.add_paragraph(style="Code Block")
                run = p.add_run(line)
                run.font.name = "Consolas"
                run.font.size = Pt(8.5)
            pending_number = 1
            continue

        line = block["text"]
        stripped = line.strip()
        if not stripped:
            pending_number = 1
            continue

        if stripped.startswith("# "):
            doc.add_heading(stripped[2:].strip(), level=1)
        elif stripped.startswith("## "):
            doc.add_heading(stripped[3:].strip(), level=2)
        elif stripped.startswith("### "):
            doc.add_heading(stripped[4:].strip(), level=3)
        elif re.match(r"^[-*]\s+", stripped):
            doc.add_paragraph(re.sub(r"^[-*]\s+", "", stripped), style="List Bullet")
        elif re.match(r"^\d+[.)]\s+", stripped):
            doc.add_paragraph(re.sub(r"^\d+[.)]\s+", "", stripped), style="List Number")
            pending_number += 1
        else:
            doc.add_paragraph(stripped)


def create_study_docx(payload):
    try:
        from docx import Document
        from docx.shared import Pt
    except Exception as exc:
        raise RuntimeError(f"python-docx is required to create DOCX files: {exc}") from exc

    title = payload.get("title") or "Courseware Study Notes"
    subtitle = payload.get("subtitle") or "Structured summary, review points, and exam preparation notes"
    content = payload.get("content_markdown") or ""
    mindmap = payload.get("mindmap_mermaid") or ""
    output_path = Path(payload.get("output_path") or default_output_path(title, ".docx"))
    output_path.parent.mkdir(parents=True, exist_ok=True)

    doc = Document()
    configure_doc(doc)
    doc.add_paragraph(title, style="Study Title")
    if subtitle:
        doc.add_paragraph(subtitle, style="Study Subtitle")
    add_markdown_to_doc(doc, content)

    if mindmap.strip():
        doc.add_page_break()
        doc.add_heading("Mermaid Mind Map Source", level=1)
        add_markdown_to_doc(doc, f"```mermaid\n{extract_mermaid(mindmap)}\n```")

    doc.core_properties.title = title
    doc.core_properties.subject = "Courseware study notes"
    doc.save(output_path)
    return {
        "type": "docx",
        "path": str(output_path.resolve()),
        "title": title,
        "bytes": output_path.stat().st_size,
    }


def extract_mermaid(value):
    text = (value or "").strip()
    match = re.search(r"```(?:mermaid)?\s*(.*?)```", text, flags=re.DOTALL | re.IGNORECASE)
    if match:
        text = match.group(1).strip()
    return text


def create_mind_map_file(payload):
    title = payload.get("title") or "Courseware Mind Map"
    mermaid = extract_mermaid(payload.get("mermaid_mindmap") or "")
    if not mermaid:
        raise ValueError("mermaid_mindmap is required.")
    if not mermaid.lstrip().startswith("mindmap"):
        mermaid = "mindmap\n" + mermaid

    file_format = (payload.get("format") or "md").lower()
    suffix = ".mmd" if file_format == "mmd" else ".md"
    output_path = Path(payload.get("output_path") or default_output_path(title, suffix))
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if suffix == ".mmd":
        content = mermaid.rstrip() + "\n"
    else:
        content = f"# {title}\n\n```mermaid\n{mermaid.rstrip()}\n```\n"
    output_path.write_text(content, encoding="utf-8")
    return {
        "type": "mindmap",
        "path": str(output_path.resolve()),
        "title": title,
        "format": file_format,
        "bytes": output_path.stat().st_size,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["docx", "mindmap"])
    args = parser.parse_args()
    payload = json.load(sys.stdin)
    if args.mode == "docx":
        result = create_study_docx(payload)
    else:
        result = create_mind_map_file(payload)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
