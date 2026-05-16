#!/usr/bin/env python3
"""Generate a 1200x630 Open Graph cover for X / Twitter share cards."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AVATAR = ROOT / "static/images/brand/yiqun-avatar.png"
OUT = ROOT / "static/images/brand/og-cover.png"

W, H = 1200, 630
BG = (24, 24, 28)
ACCENT = (255, 255, 255)
SUB = (170, 170, 175)

FONT_BOLD = "/System/Library/Fonts/STHeiti Medium.ttc"
FONT_REG = "/System/Library/Fonts/STHeiti Light.ttc"

img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

# Subtle accent stripe
draw.rectangle([(0, 0), (W, 6)], fill=(110, 130, 200))

# Avatar (circular)
avatar_size = 220
avatar = Image.open(AVATAR).convert("RGBA").resize((avatar_size, avatar_size), Image.LANCZOS)
mask = Image.new("L", (avatar_size, avatar_size), 0)
ImageDraw.Draw(mask).ellipse((0, 0, avatar_size, avatar_size), fill=255)
avatar_x = 110
avatar_y = (H - avatar_size) // 2
img.paste(avatar, (avatar_x, avatar_y), mask)

# Text block
text_x = avatar_x + avatar_size + 70
title_font = ImageFont.truetype(FONT_BOLD, 110)
sub_font = ImageFont.truetype(FONT_REG, 48)
foot_font = ImageFont.truetype(FONT_REG, 32)

title = "轶群说"
sub = "记录生活，分享感悟"
foot = "luisy92.win"

# Vertically center title + sub as a group
title_bbox = draw.textbbox((0, 0), title, font=title_font)
sub_bbox = draw.textbbox((0, 0), sub, font=sub_font)
gap = 30
total_h = (title_bbox[3] - title_bbox[1]) + gap + (sub_bbox[3] - sub_bbox[1])
group_top = (H - total_h) // 2 - 20

draw.text((text_x, group_top - title_bbox[1]), title, font=title_font, fill=ACCENT)
draw.text(
    (text_x, group_top + (title_bbox[3] - title_bbox[1]) + gap - sub_bbox[1]),
    sub,
    font=sub_font,
    fill=SUB,
)

# Footer URL (bottom-right)
foot_bbox = draw.textbbox((0, 0), foot, font=foot_font)
draw.text(
    (W - (foot_bbox[2] - foot_bbox[0]) - 60, H - (foot_bbox[3] - foot_bbox[1]) - 50),
    foot,
    font=foot_font,
    fill=SUB,
)

img.save(OUT, "PNG", optimize=True)
print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
