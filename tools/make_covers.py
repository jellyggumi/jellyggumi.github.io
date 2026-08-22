#!/usr/bin/env python3
"""Generate post cover images.

Every post declares `image.feature` / `header-img`, which the post layout paints
full-bleed behind white heading text. Fifteen new posts referenced covers that did
not exist, so those headers rendered as a flat grey block.

Rather than stock photography of a country these posts describe first-hand, each
cover is a generated abstract composition keyed to its subject: a shelf grid for
convenience stores, a steam-and-bulb market alley, a palace bracket silhouette, a
river with bridge spans. Constraints every cover satisfies:

  * 1375x675, matching the existing pc00X covers.
  * Dark, with the left ~45% kept clear, because the layout overlays a white H1
    and subtitle there. Contrast is asserted at the end of this script.
  * Deterministic: seeded per filename, so a rebuild reproduces byte-identical
    output and does not churn the repo.

Run from the repo root:  python3 tools/make_covers.py
"""

import math
import pathlib
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1375, 675
OUT = pathlib.Path(__file__).resolve().parent.parent / "img" / "postcover"
KO_FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"

# Category palettes: (top, bottom) of the base gradient, then an accent. Posts in the
# same category share a base so the journal index reads as a coherent set.
# Values are mid-tone, not near-black: the existing pc00X covers average a luminance
# around 100-130, and a near-black header reads as a broken image rather than a
# photograph. The headline stays legible via a left-side scrim applied after the
# motif, so only the text region is darkened.
PALETTE = {
    "daily":   ((58, 74, 96),  (20, 27, 36), (255, 205, 130)),
    "food":    ((96, 54, 40),  (30, 16, 13), (255, 168, 104)),
    "culture": ((48, 62, 104), (17, 22, 38), (168, 202, 255)),
    "travel":  ((40, 84, 84),  (14, 30, 31), (140, 226, 210)),
    "family":  ((92, 50, 70),  (30, 16, 23), (250, 176, 200)),
}


def vgrad(top, bottom):
    g = Image.new("RGB", (1, H))
    for y in range(H):
        t = y / (H - 1)
        g.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return g.resize((W, H), Image.BILINEAR)


def glow(draw, cx, cy, r, rgb, peak=34, squash=0.72):
    """Soft radial pool. Drawn as concentric ellipses with quadratic falloff so it
    reads as light in the scene rather than a pasted-on blob."""
    steps = max(8, r // 6)
    for i in range(steps, 0, -1):
        rad = r * i / steps
        a = int(peak * (1 - i / steps) ** 2)
        if a <= 0:
            continue
        draw.ellipse([cx - rad, cy - rad * squash, cx + rad, cy + rad * squash],
                     fill=rgb + (a,))


def grain(img, amount=7, seed=0):
    rnd = random.Random(seed)
    n = Image.new("L", (img.width // 2, img.height // 2))
    n.putdata([int(max(0, min(255, rnd.gauss(128, amount)))) for _ in range(n.width * n.height)])
    n = n.resize(img.size, Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.4))
    return Image.blend(img, Image.merge("RGB", (n, n, n)), 0.10)


def scrim(img, reach=0.62, strength=0.72):
    """Darken the left side only, where the layout paints the white H1 and subtitle.

    A symmetric vignette was the first attempt and it was wrong: darkening all four
    edges to seat the headline dragged the whole frame to a near-black mean of ~20
    against ~110 for the existing covers, so the motif stopped being visible at all.
    This instead ramps a black wash from full strength at the left edge to nothing by
    `reach` across the frame, leaving the right side at its painted brightness.
    """
    ramp = Image.new("L", (W, 1))
    cutoff = W * reach
    for x in range(W):
        if x >= cutoff:
            v = 0
        else:
            t = 1 - (x / cutoff)          # 1 at the left edge, 0 at the cutoff
            v = int(255 * strength * t ** 1.5)   # eased so the falloff is not a hard band
        ramp.putpixel((x, 0), v)
    mask = ramp.resize((W, H), Image.BILINEAR).filter(ImageFilter.GaussianBlur(24))
    dark = Image.new("RGB", (W, H), (0, 0, 0))
    return Image.composite(dark, img, mask)


def top_shade(img, strength=0.30):
    """Slight top-down darkening. The fixed navbar sits over the top of the header,
    and its links are white."""
    ramp = Image.new("L", (1, H))
    for y in range(H):
        t = max(0.0, 1 - y / (H * 0.45))
        ramp.putpixel((0, y), int(255 * strength * t))
    mask = ramp.resize((W, H), Image.BILINEAR)
    dark = Image.new("RGB", (W, H), (0, 0, 0))
    return Image.composite(dark, img, mask)


def hangul(img, text, xy, size, rgb, alpha=30, index=1):
    """A large, low-contrast Hangul glyph set as a texture element, not as a label."""
    try:
        font = ImageFont.truetype(KO_FONT, size, index=index)
    except OSError:
        return
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).text(xy, text, font=font, fill=rgb + (alpha,))
    img.alpha_composite(layer) if img.mode == "RGBA" else img.paste(
        Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB"), (0, 0))


# --------------------------------------------------------------------------------
# Motifs. Each takes (draw, accent, rnd) and paints into the right/centre of frame.
# --------------------------------------------------------------------------------

def m_shelves(d, acc, rnd):
    """Convenience store: lit shelf grid receding right."""
    glow(d, 980, 250, 330, acc, peak=30)
    glow(d, 1210, 450, 250, (120, 200, 255), peak=22)
    for c in range(6):
        x = 800 + c * 108
        d.line([(x, 110), (x, 610)], fill=(255, 255, 255, 20), width=2)
    for r in range(6):
        y = 150 + r * 80
        d.line([(790, y), (W, y - r * 5)], fill=(255, 255, 255, 24), width=2)
        for k in range(6):
            bx = 808 + k * 108 + rnd.randint(-3, 3)
            bh = rnd.randint(28, 50)
            d.rectangle([bx, y - bh, bx + 84, y - 5],
                        fill=(255, 240, 214, rnd.randint(20, 48)))


def m_signal(d, acc, rnd):
    """Connectivity: concentric signal arcs over a platform edge line."""
    glow(d, 1080, 330, 360, acc, peak=26)
    cx, cy = 1080, 470
    for i in range(1, 8):
        r = i * 62
        d.arc([cx - r, cy - r, cx + r, cy + r], start=210, end=330,
              fill=acc + (max(8, 54 - i * 6),), width=3)
    d.line([(720, 556), (W, 512)], fill=(255, 255, 255, 40), width=3)
    for k in range(9):
        x = 760 + k * 70
        d.line([(x, 560), (x, 596)], fill=(255, 255, 255, 16), width=2)


def m_cafe(d, acc, rnd):
    """Cafe: tall glass with condensation beads and a window light wash."""
    glow(d, 1010, 300, 340, (255, 236, 200), peak=24)
    gx, gy, gw, gh = 980, 210, 128, 330
    d.rounded_rectangle([gx, gy, gx + gw, gy + gh], radius=10,
                        outline=(255, 255, 255, 54), width=3)
    d.rounded_rectangle([gx + 8, gy + 96, gx + gw - 8, gy + gh - 8], radius=8,
                        fill=(96, 58, 34, 96))
    for k in range(7):  # ice
        ix = gx + 18 + rnd.randint(0, gw - 60)
        iy = gy + 108 + rnd.randint(0, 120)
        d.rounded_rectangle([ix, iy, ix + 34, iy + 30], radius=5,
                            fill=(255, 255, 255, rnd.randint(20, 40)))
    for k in range(26):  # condensation
        bx, by = gx + rnd.randint(2, gw - 4), gy + rnd.randint(100, gh - 10)
        r = rnd.randint(2, 4)
        d.ellipse([bx, by, bx + r, by + r], fill=(255, 255, 255, rnd.randint(30, 70)))
    d.line([(1215, 150), (1215, 600)], fill=(255, 255, 255, 20), width=2)
    d.line([(1300, 150), (1300, 600)], fill=(255, 255, 255, 14), width=2)


def m_market(d, acc, rnd):
    """Market alley: hanging bulbs over an awning line and stacked produce crates.

    Deliberately no vertical steam plumes — m_bath and m_bbq also wanted them, and
    three covers built from the same stacked-ellipse column read as the same picture
    in three colours. Here the silhouette is angular: awning, crates, bulbs.
    """
    # awning scallops across the top, giving the alley a covered feel
    for k in range(7):
        ax = 780 + k * 90
        d.arc([ax, 92, ax + 90, 168], start=0, end=180,
              fill=(255, 255, 255, 34), width=3)
    d.line([(770, 130), (W, 130)], fill=(255, 255, 255, 40), width=3)

    # bulb string, slung with a slight catenary sag
    for k in range(6):
        bx = 812 + k * 100
        sag = int(26 * math.sin(math.pi * (k + 0.5) / 6))
        by = 196 + sag
        d.line([(bx, 132), (bx, by)], fill=(255, 255, 255, 30), width=2)
        glow(d, bx, by + 12, 78, (255, 196, 116), peak=52, squash=1.0)
        d.ellipse([bx - 9, by + 3, bx + 9, by + 21], fill=(255, 230, 176, 225))

    # produce crates stacked along the stall front
    for k in range(5):
        cx = 800 + k * 116
        ch = rnd.randint(56, 84)
        cy = 470 - ch
        d.rectangle([cx, cy, cx + 100, 470],
                    fill=(255, 226, 186, 22), outline=(255, 235, 200, 62), width=2)
        d.line([(cx, cy + ch // 2), (cx + 100, cy + ch // 2)],
               fill=(255, 235, 200, 34), width=2)
        for j in range(3):  # goods heaped above the rim
            gx2 = cx + 14 + j * 30
            d.ellipse([gx2, cy - 20, gx2 + 26, cy + 4],
                      fill=(255, 210, 160, rnd.randint(40, 78)))

    d.rectangle([760, 470, W, 496], fill=(255, 190, 120, 40))
    d.rectangle([760, 496, W, 626], fill=(0, 0, 0, 74))


def m_bath(d, acc, rnd):
    """Jjimjilbang: water-dominant. Concentric ripples from a single point, a low
    horizontal steam haze rather than columns, and a tiled pool lip."""
    glow(d, 1060, 420, 400, (170, 210, 255), peak=30)

    # concentric ripples radiating from one drop point, flattened into perspective
    cx, cy = 1080, 430
    for i in range(1, 11):
        r = i * 46
        d.ellipse([cx - r, cy - r * 0.30, cx + r, cy + r * 0.30],
                  outline=(200, 232, 255, max(10, 60 - i * 5)), width=2)

    # steam as a flat drifting haze band, not rising plumes
    for k in range(16):
        hx = 760 + rnd.randint(0, 600)
        hy = 250 + rnd.randint(0, 90)
        rw = rnd.randint(90, 200)
        rh = rnd.randint(14, 30)
        d.ellipse([hx, hy, hx + rw, hy + rh],
                  fill=(255, 255, 255, rnd.randint(6, 15)))

    # pool lip and tiling
    d.line([(740, 570), (W, 570)], fill=(255, 255, 255, 46), width=4)
    for gx in range(760, W, 58):
        d.line([(gx, 574), (gx, H)], fill=(255, 255, 255, 18), width=2)
    for gy in range(596, H, 40):
        d.line([(740, gy), (W, gy)], fill=(255, 255, 255, 14), width=2)


def m_holiday(d, acc, rnd):
    """Seollal / Chuseok: full moon and stacked rice-cake rounds."""
    glow(d, 1120, 210, 300, (215, 230, 255), peak=30)
    d.ellipse([1040, 130, 1200, 290], fill=(238, 244, 255, 190))
    d.ellipse([1040, 130, 1200, 290], outline=(255, 255, 255, 90), width=2)
    for row, n in enumerate([3, 2, 1]):
        for k in range(n):
            cx = 900 + k * 130 + row * 65
            cy = 560 - row * 62
            d.ellipse([cx, cy, cx + 116, cy + 50],
                      fill=(255, 245, 232, 42), outline=(255, 255, 255, 60), width=2)


def m_waste(d, acc, rnd):
    """Recycling: three sorted bins as nested squares plus a stacked-bag silhouette."""
    glow(d, 1040, 330, 320, acc, peak=22)
    for i, x in enumerate([820, 1010, 1200]):
        for k in range(3):
            inset = k * 13
            d.rectangle([x + inset, 250 + inset, x + 150 - inset, 470 - inset],
                        outline=(255, 255, 255, 44 - k * 10), width=2)
        d.line([(x + 20, 250), (x + 130, 250)], fill=acc + (60,), width=4)
    for k in range(4):
        bx = 860 + k * 128
        d.rounded_rectangle([bx, 500, bx + 92, 596], radius=16,
                            fill=(255, 255, 255, 16), outline=(255, 255, 255, 34), width=2)


def m_beauty(d, acc, rnd):
    """Skincare: stacked layers as translucent horizontal bands, plus bottle outlines."""
    glow(d, 1060, 300, 340, (255, 205, 225), peak=24)
    for k in range(7):
        y = 200 + k * 52
        d.rounded_rectangle([800, y, W - 40, y + 34], radius=17,
                            fill=(255, 255, 255, 12 + k * 3))
    for i, (x, h) in enumerate([(880, 150), (1010, 200), (1140, 120)]):
        top = 560 - h
        d.rounded_rectangle([x, top, x + 84, 560], radius=12,
                            outline=(255, 255, 255, 58), width=3)
        d.rectangle([x + 28, top - 24, x + 56, top], fill=(255, 255, 255, 44))


def m_name(d, acc, rnd):
    """Age / names / addresses: a syllable-block grid with one block highlighted."""
    glow(d, 1050, 320, 320, acc, peak=22)
    for r in range(3):
        for c in range(4):
            x = 820 + c * 140
            y = 190 + r * 150
            on = (r == 1 and c == 2)
            d.rectangle([x, y, x + 112, y + 112],
                        outline=(255, 255, 255, 80 if on else 34), width=3)
            d.line([(x + 20, y + 44), (x + 92, y + 44)],
                   fill=(255, 255, 255, 60 if on else 24), width=3)
            d.line([(x + 56, y + 44), (x + 56, y + 92)],
                   fill=(255, 255, 255, 60 if on else 24), width=3)
            if on:
                glow(d, x + 56, y + 56, 120, acc, peak=40)


def m_palace(d, acc, rnd):
    """Palace: tiered eave silhouette with bracket dentils."""
    glow(d, 1080, 470, 380, (150, 195, 255), peak=22)
    for tier, (y, half, w_) in enumerate([(250, 300, 3), (360, 250, 3), (470, 200, 3)]):
        cx = 1080
        d.line([(cx - half, y + 40), (cx - half + 60, y), (cx + half - 60, y),
                (cx + half, y + 40)], fill=(255, 255, 255, 54), width=w_ + 1, joint="curve")
        d.line([(cx - half + 30, y + 46), (cx + half - 30, y + 46)],
               fill=(255, 255, 255, 34), width=w_)
        for k in range(9):
            bx = cx - half + 46 + k * (2 * half - 92) // 8
            d.rectangle([bx - 7, y + 50, bx + 7, y + 74], fill=(255, 255, 255, 26))
    for k in range(3):
        px = 940 + k * 140
        d.rectangle([px, 560, px + 22, 640], fill=(255, 255, 255, 22))


def m_bbq(d, acc, rnd):
    """Korean BBQ: round grill with bars, glowing coals, laterally drifting smoke."""
    glow(d, 1050, 420, 330, (255, 138, 74), peak=40)
    d.ellipse([870, 330, 1230, 530], outline=(255, 255, 255, 60), width=4)
    d.ellipse([900, 344, 1200, 516], fill=(30, 12, 8, 120))
    for k in range(9):
        y = 356 + k * 18
        d.line([(906, y), (1194, y)], fill=(255, 255, 255, 38), width=3)
    for k in range(18):
        cx = 930 + rnd.randint(0, 240)
        cy = 372 + rnd.randint(0, 120)
        r = rnd.randint(6, 15)
        d.ellipse([cx, cy, cx + r, cy + r * 0.7],
                  fill=(255, rnd.randint(120, 190), 70, rnd.randint(60, 140)))
    # Smoke drifts sideways toward the extraction hood rather than rising in columns,
    # which is both what actually happens over a Korean grill table and what keeps
    # this cover from sharing a silhouette with m_market and m_bath.
    for k in range(5):
        sx, sy = 1000 + k * 34, 320 - k * 6
        for s in range(11):
            drift = s * 26          # lateral pull
            rise = s * 13           # much shallower climb than the plume version
            r = 16 + s * 7
            d.ellipse([sx + drift - r, sy - rise - r * 0.45,
                       sx + drift + r, sy - rise + r * 0.45],
                      fill=(255, 255, 255, max(3, 16 - s)))
    # hood lip the smoke is being drawn toward
    d.line([(1140, 150), (W, 128)], fill=(255, 255, 255, 40), width=4)
    d.line([(1180, 150), (1180, 178)], fill=(255, 255, 255, 22), width=2)


def m_regional(d, acc, rnd):
    """Regional food: node-and-link map suggesting a peninsula of towns."""
    glow(d, 1070, 340, 340, acc, peak=20)
    nodes = [(940, 200), (1180, 250), (1010, 330), (1230, 400),
             (930, 430), (1120, 470), (1010, 570), (1240, 560)]
    for i, (x, y) in enumerate(nodes):
        for j, (x2, y2) in enumerate(nodes):
            if j <= i or (abs(x - x2) + abs(y - y2)) > 260:
                continue
            d.line([(x, y), (x2, y2)], fill=(255, 255, 255, 18), width=2)
    for i, (x, y) in enumerate(nodes):
        r = 9 + (i % 3) * 5
        glow(d, x, y, 70, acc, peak=30, squash=1.0)
        d.ellipse([x - r, y - r, x + r, y + r], fill=acc + (150,))


def m_temple(d, acc, rnd):
    """Temple stay: lantern rows and a still meditation circle."""
    glow(d, 1080, 300, 340, (255, 190, 120), peak=24)
    for r in range(3):
        for c in range(5):
            lx = 850 + c * 104 + r * 26
            ly = 170 + r * 96
            d.line([(lx + 26, ly - 34), (lx + 26, ly)], fill=(255, 255, 255, 22), width=2)
            glow(d, lx + 26, ly + 24, 62, (255, 176, 96), peak=40, squash=1.0)
            d.rounded_rectangle([lx, ly, lx + 52, ly + 48], radius=14,
                                fill=(255, 196, 120, 60), outline=(255, 225, 170, 96), width=2)
    d.ellipse([980, 486, 1180, 606], outline=(255, 255, 255, 44), width=3)
    d.ellipse([1016, 504, 1144, 588], outline=(255, 255, 255, 22), width=2)


def m_river(d, acc, rnd):
    """Han river: bridge spans over banded water with city lights behind."""
    for k in range(16):  # skyline
        bx = 780 + k * 40
        bh = rnd.randint(40, 150)
        d.rectangle([bx, 300 - bh, bx + 30, 300], fill=(255, 255, 255, 14))
        for wy in range(300 - bh + 12, 296, 22):
            d.rectangle([bx + 8, wy, bx + 15, wy + 7], fill=(255, 232, 180, 40))
    d.line([(720, 330), (W, 318)], fill=(255, 255, 255, 46), width=4)
    for k in range(5):  # spans
        sx = 780 + k * 140
        d.arc([sx, 300, sx + 150, 400], start=180, end=360,
              fill=(255, 255, 255, 40), width=3)
        d.line([(sx + 75, 300), (sx + 75, 336)], fill=(255, 255, 255, 30), width=2)
    for k in range(9):  # water
        y = 380 + k * 30
        amp = 8 - k // 2
        pts = [(x, y + math.sin(x / 54 + k * 0.7) * amp) for x in range(700, W, 12)]
        d.line(pts, fill=(150, 205, 220, max(9, 40 - k * 4)), width=2)
    glow(d, 1120, 420, 300, (120, 214, 200), peak=18)


def m_dol(d, acc, rnd):
    """Doljanchi: a low table arc with stacked offerings and a single ring."""
    glow(d, 1060, 380, 340, (255, 180, 205), peak=26)
    d.arc([800, 300, 1330, 560], start=200, end=340, fill=(255, 255, 255, 50), width=4)
    for i, (x, n) in enumerate([(880, 3), (1020, 4), (1170, 3)]):
        for k in range(n):
            y = 470 - k * 28
            d.ellipse([x, y, x + 104, y + 34],
                      fill=(255, 246, 238, 34), outline=(255, 255, 255, 56), width=2)
    d.ellipse([1120, 250, 1196, 326], outline=(255, 214, 150, 150), width=6)
    glow(d, 1158, 288, 120, (255, 205, 130), peak=44, squash=1.0)


COVERS = [
    # file,       palette,   motif,      hangul glyph, seed
    ("pc101.jpg", "daily",   m_shelves,  "편의점", 101),
    ("pc102.jpg", "daily",   m_signal,   "연결",   102),
    ("pc103.jpg", "food",    m_cafe,     "카페",   103),
    ("pc104.jpg", "food",    m_market,   "시장",   104),
    ("pc105.jpg", "culture", m_bath,     "찜질방", 105),
    ("pc106.jpg", "culture", m_holiday,  "명절",   106),
    ("pc107.jpg", "daily",   m_waste,    "분리수거", 107),
    ("pc108.jpg", "daily",   m_beauty,   "화장품", 108),
    ("pc109.jpg", "culture", m_name,     "이름",   109),
    ("pc110.jpg", "travel",  m_palace,   "궁궐",   110),
    ("pc111.jpg", "food",    m_bbq,      "고기",   111),
    ("pc112.jpg", "food",    m_regional, "향토음식", 112),
    ("pc113.jpg", "travel",  m_temple,   "템플스테이", 113),
    ("pc114.jpg", "travel",  m_river,    "한강",   114),
    ("pc115.jpg", "family",  m_dol,      "돌잔치", 115),
]


def luminance(rgb):
    def f(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def region_stats(img, box):
    """Mean colour of a region plus its contrast ratio against white text."""
    region = img.crop(box).resize((40, 20), Image.BILINEAR)
    px = list(region.convert("RGB").getdata())
    mean = tuple(sum(c[i] for c in px) // len(px) for i in range(3))
    return 1.05 / (luminance(mean) + 0.05), mean


def build(name, pal_key, motif, glyph, seed):
    top, bottom, acc = PALETTE[pal_key]
    base = vgrad(top, bottom).convert("RGB")
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer, "RGBA")
    motif(d, acc, random.Random(seed))
    # Motif drawn twice: the alphas are tuned for a dark base, and one pass over the
    # brighter mid-tone gradient reads as washed out. A second composite of the same
    # layer deepens it without retuning every motif's constants.
    img = Image.alpha_composite(base.convert("RGBA"), layer)
    img = Image.alpha_composite(img, layer).convert("RGB")
    hangul(img, glyph, (806, 60), 124, (255, 255, 255), alpha=26, index=1)
    img = top_shade(img, strength=0.28)
    img = scrim(img, reach=0.60, strength=0.74)
    img = grain(img, seed=seed)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    failures = []
    for name, pal, motif, glyph, seed in COVERS:
        img = build(name, pal, motif, glyph, seed)
        path = OUT / name
        img.save(path, "JPEG", quality=86, optimize=True, progressive=True)

        # Thumbnail for the journal card grid, same convention as the gallery pass.
        th = img.copy()
        th.thumbnail((700, 700), Image.LANCZOS)
        th.save(path.with_suffix(".thumb.webp"), "WEBP", quality=78, method=6)

        # Two assertions, because the two failure modes pull in opposite directions.
        # Headline region (left, over Bootstrap's offset column): must be dark enough
        # for white text -> >= 4.5:1. Motif region (right): must stay bright enough to
        # actually be seen -> the first attempt darkened everything to a mean of ~20
        # and the covers read as broken images.
        head_ratio, head_mean = region_stats(img, (90, 150, 620, 520))
        art_ratio, art_mean = region_stats(img, (860, 120, 1340, 600))
        head_ok = head_ratio >= 4.5
        art_ok = max(art_mean) >= 45
        if not (head_ok and art_ok):
            failures.append((name, f"headline {head_ratio:.2f}:1", f"motif peak {max(art_mean)}"))
        print(f"{name}  {path.stat().st_size/1e3:6.1f} KB  "
              f"headline {head_ratio:5.2f}:1 {'ok ' if head_ok else 'LIGHT'}  "
              f"motif rgb {str(art_mean):16} {'ok' if art_ok else 'TOO DARK'}")

    if failures:
        print("\nFAILED contrast:", failures, file=sys.stderr)
        return 1
    print(f"\n{len(COVERS)} covers written to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
