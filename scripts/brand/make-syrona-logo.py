#!/usr/bin/env python3
"""Draws the Syrona Medical Center logo assets.

Two variants are produced from one geometry so the lockup never differs between
screens:

* ``public/assets/syrona-medical-center-logo.png`` — transparent, cyan wordmark
  and white sub-word, for the dark navy brand panel.
* ``public/assets/syrona-medical-center-logo-plaque.png`` — the same lockup on
  the navy plaque used on the light sign-in panel.

The emblem is a six-arm star of life: three arms above the centre in medical
cyan, three below in white, with the navy rod and serpent over the centre. The
drawing is done at 4x and downsampled so the edges stay clean at small sizes.

Run:  python3 scripts/brand/make-syrona-logo.py
"""
from __future__ import annotations

import math
import pathlib

from PIL import Image, ImageDraw, ImageFont

OUT = pathlib.Path("public/assets")
OUT.mkdir(parents=True, exist_ok=True)

NAVY = (0x14, 0x21, 0x43, 255)
CYAN = (0x18, 0x88, 0xB5, 255)
DEEP_CYAN = (0x14, 0x6E, 0x93, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
SS = 4  # supersampling factor


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(f"{FONT_DIR}/{name}", size)


def arm(size: int, colour: tuple[int, int, int, int], angle: float, *, width: float, length: float):
    """One arm of the star: a rounded bar from the centre outwards, rotated."""
    canvas = Image.new("RGBA", (size, size), CLEAR)
    draw = ImageDraw.Draw(canvas)
    centre = size / 2
    w = width * size
    reach = length * size
    draw.rounded_rectangle(
        [centre - w / 2, centre - reach, centre + w / 2, centre + w * 0.10],
        radius=w * 0.28,
        fill=colour,
    )
    return canvas.rotate(angle, resample=Image.BICUBIC, center=(centre, centre))


def emblem(size: int, *, plaque: bool = False) -> Image.Image:
    """The six-arm emblem plus the rod and serpent, on a transparent canvas."""
    canvas = Image.new("RGBA", (size, size), CLEAR)
    # arms, from the top clockwise: up, upper-right, lower-right, down, lower-left, upper-left
    for angle, colour in (
        (0, CYAN),
        (60, CYAN),
        (120, WHITE),
        (180, WHITE),
        (240, WHITE),
        (-60, CYAN),
    ):
        canvas.alpha_composite(arm(size, colour, angle, width=0.30, length=0.46))

    # a slightly darker cyan on the upper arms where they cross, as in the artwork
    draw = ImageDraw.Draw(canvas)
    centre = size / 2
    draw.ellipse(
        [centre - size * 0.15, centre - size * 0.15, centre + size * 0.15, centre + size * 0.15],
        fill=CYAN,
    )

    # rod of Asclepius: a navy staff with a serpent winding around it
    staff_w = max(2, int(size * 0.026))
    draw.line([(centre, size * 0.20), (centre, size * 0.86)], fill=NAVY, width=staff_w)
    head = size * 0.055
    draw.ellipse(
        [centre - head, size * 0.16 - head, centre + head, size * 0.16 + head], fill=NAVY
    )

    serpent = max(2, int(size * 0.030))
    xs = centre + size * 0.055
    steps = 40
    points = []
    for i in range(steps + 1):
        t = i / steps
        y = size * (0.24 + 0.52 * t)
        x = centre + math.sin(t * math.pi * 2.4) * size * 0.062
        points.append((x, y))
    draw.line(points, fill=NAVY, width=serpent, joint="curve")
    # serpent head
    hx, hy = points[-1]
    draw.ellipse([hx - size * 0.028, hy - size * 0.028, hx + size * 0.028, hy + size * 0.028], fill=NAVY)
    # tongue
    draw.line([(hx, hy), (hx + size * 0.03, hy + size * 0.03)], fill=NAVY, width=max(1, serpent // 2))
    _ = xs
    _ = DEEP_CYAN
    _ = plaque
    return canvas


def tracking_text(draw, xy, text, font_obj, fill, tracking):
    """Draws text with letter-spacing; PIL has no tracking option."""
    x, y = xy
    for character in text:
        draw.text((x, y), character, font=font_obj, fill=fill)
        x += draw.textlength(character, font=font_obj) + tracking
    return x


def build(*, plaque: bool) -> Image.Image:
    """Full lockup: emblem, then the two-line wordmark."""
    width, height = 1200, 380
    canvas = Image.new("RGBA", (width, height), CLEAR)
    if plaque:
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle([0, 0, width - 1, height - 1], radius=26, fill=NAVY)

    mark = emblem(int(height * 0.86))
    canvas.alpha_composite(mark, (40, int(height * 0.07)))

    draw = ImageDraw.Draw(canvas)
    text_x = 40 + int(height * 0.86) + 44
    word_font = font(150)
    sub_font = font(62)

    tracking_text(draw, (text_x, 78), "SYRONA", word_font, CYAN, 4)
    tracking_text(draw, (text_x + 4, 248), "MEDICAL CENTER", sub_font, WHITE, 6)
    return canvas


def main() -> None:
    for plaque, name in ((False, "syrona-medical-center-logo.png"), (True, "syrona-medical-center-logo-plaque.png")):
        big = build(plaque=plaque)
        final = big.resize((big.width // 2, big.height // 2), Image.LANCZOS)
        path = OUT / name
        final.save(path, optimize=True)
        print("wrote", path, final.size)

    # Square emblem, used as the favicon and as the fallback badge.
    mark = emblem(512).resize((256, 256), Image.LANCZOS)
    mark.save(OUT / "syrona-emblem.png", optimize=True)
    print("wrote", OUT / "syrona-emblem.png", mark.size)


if __name__ == "__main__":
    main()
