#!/usr/bin/env python3
"""Builds the e2e font fixture.

The font-identity test needs a font file that is three things at once: real
enough for Chrome to load and paint with, small enough to live in the repo, and
licensed so that shipping it in a test fixture is unambiguous. No third-party
font is all three, so this builds one: an original face with plain rectangular
glyphs, released under the SIL Open Font License 1.1 (see OFL.txt next to it).

Its advance widths are deliberately far from any system font's, so the canvas
rendering check in lib/readings/fonts.ts can tell it apart from the monospace
and serif fallbacks and the panel can reach the `verified` label.

Regenerate with:  python3 e2e/fixtures/fonts/make-fixture-font.py
Requires fontTools and the Python brotli module, both development-only.
"""
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UPM = 1000
ASCENT = 800
DESCENT = -200
# Wide on purpose: a face whose advances match the fallback measures the same
# and would read as inconclusive rather than rendered.
ADVANCE = 820

HERE = Path(__file__).resolve().parent
FAMILY = "Inspector Test Sans"

CHARACTERS = (
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789 ,.'-"
)


def glyph_name(character: str) -> str:
    if character == " ":
        return "space"
    if character == ",":
        return "comma"
    if character == ".":
        return "period"
    if character == "'":
        return "quotesingle"
    if character == "-":
        return "hyphen"
    if character.isupper():
        return f"{character}.upper"
    return character


def box(pen: TTGlyphPen, left: int, right: int, bottom: int, top: int) -> None:
    pen.moveTo((left, bottom))
    pen.lineTo((left, top))
    pen.lineTo((right, top))
    pen.lineTo((right, bottom))
    pen.closePath()


def main() -> None:
    order = [".notdef", "space"]
    cmap = {}
    glyphs = {}
    metrics = {}

    notdef = TTGlyphPen(None)
    box(notdef, 60, ADVANCE - 60, 0, ASCENT)
    glyphs[".notdef"] = notdef.glyph()
    metrics[".notdef"] = (ADVANCE, 60)

    empty = TTGlyphPen(None)
    glyphs["space"] = empty.glyph()
    metrics["space"] = (ADVANCE, 0)
    cmap[ord(" ")] = "space"

    for character in CHARACTERS:
        if character == " ":
            continue
        name = glyph_name(character)
        if name in glyphs:
            continue
        pen = TTGlyphPen(None)
        # A plain stem, its height varying with the character so a line of this
        # font is visibly a font and not a row of identical bars.
        top = 300 + (ord(character) % 5) * 100
        box(pen, 90, ADVANCE - 160, 0, top)
        glyphs[name] = pen.glyph()
        metrics[name] = (ADVANCE, 90)
        cmap[ord(character)] = name
        order.append(name)

    builder = FontBuilder(UPM, isTTF=True)
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap(cmap)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    builder.setupNameTable(
        {
            "familyName": FAMILY,
            "styleName": "Regular",
            "uniqueFontIdentifier": f"{FAMILY} Regular; 1.000",
            "fullName": f"{FAMILY} Regular",
            "psName": "InspectorTestSans-Regular",
            "version": "Version 1.000",
            "manufacturer": "Design Inspector Fixtures",
            "designer": "Design Inspector Fixtures",
            "licenseDescription": (
                "This Font Software is licensed under the SIL Open Font License, "
                "Version 1.1. This license is available with a FAQ at "
                "https://openfontlicense.org."
            ),
            "licenseInfoURL": "https://openfontlicense.org",
            "typographicFamily": FAMILY,
            "typographicSubfamily": "Regular",
        }
    )
    builder.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT, usWinAscent=ASCENT, usWinDescent=-DESCENT)
    builder.setupPost()

    builder.font.flavor = "woff2"
    target = HERE / "inspector-test-sans.woff2"
    builder.save(str(target))
    print(f"wrote {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
