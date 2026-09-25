"""Gera o PDF versionado das validações reais a partir do Markdown.

Uso:
    python scripts/generate-validation-pdf.py

Dependência de documentação:
    python -m pip install reportlab
"""

from __future__ import annotations

import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "VALIDACOES-REAIS-PENDENTES.md"
OUTPUT = ROOT / "docs" / "VALIDACOES-REAIS-PENDENTES.pdf"


def register_fonts() -> tuple[str, str]:
    candidates = [
        (
            Path("C:/Windows/Fonts/arial.ttf"),
            Path("C:/Windows/Fonts/arialbd.ttf"),
        ),
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ),
    ]
    for regular, bold in candidates:
        if regular.exists() and bold.exists():
            pdfmetrics.registerFont(TTFont("AtendaraSans", regular))
            pdfmetrics.registerFont(TTFont("AtendaraSansBold", bold))
            return "AtendaraSans", "AtendaraSansBold"
    return "Helvetica", "Helvetica-Bold"


FONT, FONT_BOLD = register_fonts()


def inline_markup(text: str) -> str:
    escaped = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    escaped = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"\[([^]]+)]\(([^)]+)\)", r"<u>\1</u>", escaped)
    return escaped


def styles():
    base = getSampleStyleSheet()
    base.add(
        ParagraphStyle(
            "DocumentTitle",
            fontName=FONT_BOLD,
            fontSize=21,
            leading=25,
            textColor=colors.HexColor("#21173B"),
            alignment=TA_CENTER,
            spaceAfter=8 * mm,
        )
    )
    base.add(
        ParagraphStyle(
            "H1Custom",
            fontName=FONT_BOLD,
            fontSize=15,
            leading=19,
            textColor=colors.HexColor("#3B2373"),
            spaceBefore=6 * mm,
            spaceAfter=3 * mm,
            keepWithNext=False,
        )
    )
    base.add(
        ParagraphStyle(
            "H2Custom",
            fontName=FONT_BOLD,
            fontSize=11.5,
            leading=15,
            textColor=colors.HexColor("#5A3A98"),
            spaceBefore=4 * mm,
            spaceAfter=2 * mm,
            keepWithNext=False,
        )
    )
    base.add(
        ParagraphStyle(
            "BodyCustom",
            fontName=FONT,
            fontSize=9.2,
            leading=13.2,
            textColor=colors.HexColor("#2F2A39"),
            alignment=TA_LEFT,
            spaceAfter=2.2 * mm,
        )
    )
    base.add(
        ParagraphStyle(
            "SmallCustom",
            fontName=FONT,
            fontSize=8,
            leading=11,
            textColor=colors.HexColor("#625B6E"),
        )
    )
    base.add(
        ParagraphStyle(
            "ListCustom",
            parent=base["BodyCustom"],
            leftIndent=7 * mm,
            firstLineIndent=0,
            bulletIndent=0,
            bulletFontName=FONT,
            bulletFontSize=8,
            spaceAfter=1.5 * mm,
        )
    )
    return base


def table_from(lines: list[str], style_sheet) -> Table:
    rows = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        rows.append(cells)
    if len(rows) > 1 and all(re.fullmatch(r":?-{3,}:?", cell) for cell in rows[1]):
        rows.pop(1)
    rendered = [
        [Paragraph(inline_markup(cell), style_sheet["SmallCustom"]) for cell in row]
        for row in rows
    ]
    table = Table(rendered, colWidths=[34 * mm, 132 * mm], repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEE9F8")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#2D1A52")),
                ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CFC7DD")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def parse_markdown(text: str):
    style_sheet = styles()
    story = []
    lines = text.splitlines()
    index = 0
    first_heading = True

    while index < len(lines):
        raw = lines[index].rstrip()
        stripped = raw.strip()
        if not stripped:
            index += 1
            continue

        if stripped.startswith("| "):
            table_lines = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index].strip())
                index += 1
            story.extend([table_from(table_lines, style_sheet), Spacer(1, 3 * mm)])
            continue

        if stripped.startswith("# "):
            if first_heading:
                story.append(Paragraph(inline_markup(stripped[2:]), style_sheet["DocumentTitle"]))
                first_heading = False
            else:
                story.append(PageBreak())
                story.append(Paragraph(inline_markup(stripped[2:]), style_sheet["H1Custom"]))
            index += 1
            continue

        if stripped.startswith("## "):
            story.append(Paragraph(inline_markup(stripped[3:]), style_sheet["H1Custom"]))
            index += 1
            continue

        if stripped.startswith("### "):
            story.append(Paragraph(inline_markup(stripped[4:]), style_sheet["H2Custom"]))
            index += 1
            continue

        if stripped.startswith("- ") or re.match(r"\d+\. ", stripped):
            ordered = bool(re.match(r"\d+\. ", stripped))
            items = []
            while index < len(lines):
                candidate = lines[index].strip()
                if ordered:
                    match = re.match(r"\d+\. (.+)", candidate)
                else:
                    match = re.match(r"- (.+)", candidate)
                if not match:
                    break
                items.append(match.group(1))
                index += 1
            for item_number, item in enumerate(items, start=1):
                bullet = f"{item_number}." if ordered else "•"
                story.append(Paragraph(inline_markup(item), style_sheet["ListCustom"], bulletText=bullet))
            story.append(Spacer(1, 2 * mm))
            continue

        paragraph = stripped
        index += 1
        while index < len(lines):
            candidate = lines[index].strip()
            if not candidate or candidate.startswith("#") or candidate.startswith("|"):
                break
            if candidate.startswith("- ") or re.match(r"\d+\. ", candidate):
                break
            paragraph += " " + candidate
            index += 1
        story.append(Paragraph(inline_markup(paragraph), style_sheet["BodyCustom"]))

    return story


def page_number(canvas, document) -> None:
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#DDD7E7"))
    canvas.line(20 * mm, 14 * mm, 190 * mm, 14 * mm)
    canvas.setFont(FONT, 7.5)
    canvas.setFillColor(colors.HexColor("#746D80"))
    canvas.drawString(20 * mm, 9 * mm, "Atendara — validações reais pendentes")
    canvas.drawRightString(190 * mm, 9 * mm, f"Página {document.page}")
    canvas.restoreState()


def main() -> None:
    source = SOURCE.read_text(encoding="utf-8")
    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=20 * mm,
        title="Validações reais pendentes do Atendara",
        author="Atendara",
        subject="Checklist vivo de validações externas e manuais",
    )
    document.build(parse_markdown(source), onFirstPage=page_number, onLaterPages=page_number)
    print(f"PDF gerado: {OUTPUT}")


if __name__ == "__main__":
    main()
