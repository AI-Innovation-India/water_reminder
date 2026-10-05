#!/usr/bin/env python3
"""
Generates every image Water Buddy ships with:
  characters/<id>/standing.png | drinking.png | celebrate.png
  assets/tray*.png, assets/icon.png

Run:  python3 tools/make_assets.py        (needs:  pip install pillow)

The characters are drawn in code on a 32x40 grid so the PNGs stay tiny and
crisp. Use them as a template when making your own: any PNG size works as long
as the three poses share the same dimensions.
"""
import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 32, 40
OUTLINE = "#2b1d3a"


def hexc(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


# --------------------------------------------------------------------------
# tiny drawing kit
# --------------------------------------------------------------------------
class Sprite:
    def __init__(self):
        self.img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        self.px = self.img.load()

    def opaque(self, x, y):
        return 0 <= x < W and 0 <= y < H and self.px[x, y][3] > 0

    def put(self, x, y, color):
        if 0 <= x < W and 0 <= y < H:
            self.px[x, y] = hexc(color)

    def paint(self, pixels, color, inner_outline=False):
        pixels = set(pixels)
        if inner_outline:
            for (x, y) in pixels:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    n = (x + dx, y + dy)
                    if n not in pixels and self.opaque(*n):
                        self.put(n[0], n[1], OUTLINE)
        for (x, y) in pixels:
            self.put(x, y, color)

    def finish(self):
        """Wrap the whole sprite in a 1px outline."""
        out = []
        for y in range(H):
            for x in range(W):
                if self.px[x, y][3] == 0:
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        if self.opaque(x + dx, y + dy):
                            out.append((x, y))
                            break
        for (x, y) in out:
            self.put(x, y, OUTLINE)
        return self.img


def rect(x0, y0, x1, y1):
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


def ellipse(cx, cy, rx, ry):
    pts = set()
    for y in range(H):
        for x in range(W):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0:
                pts.add((x, y))
    return pts


def line(x0, y0, x1, y1, width=2):
    """Thick line, 'width' pixels wide horizontally."""
    pts = set()
    n = max(abs(x1 - x0), abs(y1 - y0), 1)
    for i in range(n + 1):
        x = round(x0 + (x1 - x0) * i / n)
        y = round(y0 + (y1 - y0) * i / n)
        for w in range(width):
            pts.add((x + w, y))
    return pts


# --------------------------------------------------------------------------
# characters
# --------------------------------------------------------------------------
MOCHI = dict(
    id="mochi", name="Mochi",
    skin="#f1c7a3", skin_shade="#dba37f", cheek="#ff9aa8",
    hair="#2f2142", hair_hi="#58427a", hair_style="buns", accent="#ffd35a",
    top="#ff8fb1", top_shade="#e46b92", collar="#ffffff", outfit="dress",
    legs_color=None, shoes="#7a4a6c", sleeve=2, bottom=None,
)
SUNNY = dict(
    id="sunny", name="Sunny",
    skin="#c98a5e", skin_shade="#ad6f47", cheek="#f0777f",
    hair="#e8702a", hair_hi="#ffa24f", hair_style="ponytail", accent="#3ec9c1",
    top="#ffd04a", top_shade="#e6ac1c", collar="#fff3b8", outfit="hoodie",
    legs_color=None, shoes="#ffffff", sleeve=99, bottom="#3ec9c1",
)

KAI = dict(
    id="kai", name="Kai",
    skin="#f3d2b3", skin_shade="#dcb08a", cheek="#ff9a9a",
    hair="#1f3a5f", hair_hi="#4a7fc4", hair_style="short", accent="#ffffff",
    top="#4c8dff", top_shade="#2f66c9", collar="#dbe8ff", outfit="hoodie",
    legs_color=None, shoes="#ffd35a", sleeve=99, bottom="#2b3a67",
)
LUNA = dict(
    id="luna", name="Luna",
    skin="#8d5a3b", skin_shade="#74472d", cheek="#e06a7a",
    hair="#1d1a3a", hair_hi="#6a66c8", hair_style="long", accent="#ffe680",
    top="#9b6bff", top_shade="#7a4be0", collar="#f1e8ff", outfit="dress",
    legs_color=None, shoes="#ffe680", sleeve=2, bottom=None,
)

GLASS = "#e6f6ff"
WATER = "#58c2ff"
WATER_HI = "#a8e4ff"


def draw_glass(s, x, y):
    """5 wide x 7 tall glass with water."""
    body = rect(x, y, x + 4, y + 6)
    s.paint(body, GLASS, inner_outline=True)
    s.paint(rect(x + 1, y + 2, x + 3, y + 5), WATER)
    s.paint({(x + 1, y + 2), (x + 2, y + 2)}, WATER_HI)
    s.put(x, y, "#ffffff")


def hair_back(s, c):
    s.paint(ellipse(16, 13.5, 9.6, 9.4), c["hair"])
    if c["hair_style"] == "buns":
        s.paint(ellipse(6.6, 6.2, 3.4, 3.4), c["hair"])
        s.paint(ellipse(25.4, 6.2, 3.4, 3.4), c["hair"])
        for (x, y) in ((5, 4), (6, 4), (24, 4), (25, 4)):
            s.put(x, y, c["hair_hi"])
    elif c["hair_style"] == "long":  # long hair falling behind both shoulders
        s.paint(rect(7, 12, 9, 29) | rect(22, 12, 24, 29), c["hair"])
        s.paint({(8, 18), (8, 19), (23, 22), (23, 23)}, c["hair_hi"])
    elif c["hair_style"] == "short":  # short and spiky on top
        s.paint({(10, 3), (11, 3), (14, 2), (15, 2), (18, 3), (19, 3), (22, 4)}, c["hair"])
        s.paint({(14, 3), (15, 3)}, c["hair_hi"])
    else:  # ponytail, high on the right
        s.paint(line(24, 7, 28, 12, 2) | line(28, 12, 28, 20, 3) | line(28, 20, 27, 24, 2), c["hair"])
        s.paint({(28, 14), (28, 15), (29, 17)}, c["hair_hi"])


def hair_tie(s, c):
    if c["hair_style"] == "buns":
        for p in ((9, 7), (10, 8), (22, 8), (23, 7)):
            s.put(p[0], p[1], c["accent"])
    elif c["hair_style"] == "ponytail":
        for p in ((24, 7), (25, 7), (24, 8), (25, 8)):
            s.put(p[0], p[1], c["accent"])
    elif c["hair_style"] == "long":  # a little hair clip
        s.put(21, 8, c["accent"]); s.put(22, 9, c["accent"])


def body_and_legs(s, c):
    # legs
    s.paint(rect(12, 31, 14, 36) | rect(17, 31, 19, 36), c["skin"])
    s.paint(rect(14, 31, 14, 36) | rect(17, 31, 17, 36), c["skin_shade"])
    # shoes
    s.paint(rect(11, 37, 14, 38) | rect(17, 37, 20, 38), c["shoes"])
    if c["outfit"] == "dress":
        rows = {22: (12, 19), 23: (11, 20), 24: (11, 20), 25: (10, 21), 26: (10, 21),
                27: (10, 21), 28: (9, 22), 29: (9, 22), 30: (9, 22)}
        pts = set()
        for y, (a, b) in rows.items():
            pts |= {(x, y) for x in range(a, b + 1)}
        s.paint(pts, c["top"])
        # shade on the right + hem
        s.paint({(x, y) for (x, y) in pts if x >= 19 or y == 30}, c["top_shade"])
        s.paint(rect(14, 22, 17, 22), c["collar"])
        s.put(15, 23, c["collar"]); s.put(16, 23, c["collar"])
        s.put(15, 25, c["accent"]); s.put(16, 25, c["accent"])  # little bow
    else:  # hoodie + shorts
        s.paint(rect(11, 22, 20, 28), c["top"])
        s.paint(rect(19, 22, 20, 28), c["top_shade"])
        s.paint(rect(10, 22, 21, 22), c["top_shade"])           # hood rim at the neck
        s.paint(rect(13, 26, 18, 28), c["top_shade"], inner_outline=False)
        s.paint(rect(14, 27, 17, 28), c["top"])                 # pocket
        s.put(14, 24, c["collar"]); s.put(17, 24, c["collar"])  # drawstrings
        s.put(14, 25, c["collar"]); s.put(17, 25, c["collar"])
        s.paint(rect(11, 29, 20, 31), c["bottom"])
        s.paint(rect(15, 29, 16, 31), "#2fa9a2")


def head(s, c, eyes="open", mouth="smile"):
    head_pts = ellipse(16, 14, 8.6, 7.6)
    s.paint(head_pts, c["skin"], inner_outline=True)
    # front hair: cap + bangs + side locks
    hair = {(x, y) for (x, y) in head_pts if y <= 9}
    hair |= {(x, 10) for (x, y) in head_pts if y == 10}
    for x in (8, 9, 11, 12, 15, 16, 19, 20, 22, 23):
        hair.add((x, 11))
    for x in (8, 9, 22, 23):
        hair |= {(x, y) for y in range(10, 17) if (x, y) in head_pts}
    hair &= head_pts
    s.paint(hair, c["hair"])
    hi = {(11, 7), (12, 7), (13, 8), (18, 7), (19, 7)}
    s.paint(hi & hair, c["hair_hi"])
    # skin shade under the bangs
    s.paint({(x, 12) for x in range(10, 22) if (x, 12) in head_pts and (x, 11) in hair}, c["skin_shade"])
    # blush
    for p in ((9, 17), (10, 17), (21, 17), (22, 17)):
        s.put(p[0], p[1], c["cheek"])
    # eyes
    dark = "#2b1d3a"
    if eyes == "open":
        for ex in (11, 19):
            s.paint(rect(ex, 14, ex + 1, 16), dark)
            s.put(ex, 14, "#ffffff")
    else:  # happy arcs  ^ ^
        for ex in (10, 19):
            s.put(ex, 16, dark); s.put(ex + 1, 15, dark); s.put(ex + 2, 16, dark)
    # mouth
    if mouth == "smile":
        s.put(15, 18, "#b0475f"); s.put(16, 18, "#b0475f")
    elif mouth == "open":
        s.paint(rect(14, 18, 17, 19), "#8e2f4b")
        s.paint(rect(15, 19, 16, 19), "#ff8aa0")
    elif mouth == "none":
        pass


def arm(s, c, pts, hand):
    sleeve = c["sleeve"]
    length = len(pts)
    shape = set()
    for i in range(len(pts) - 1):
        shape |= line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 2)
    s.paint(shape, c["skin"], inner_outline=True)
    # sleeve: the first few pixels of the arm take the outfit colour
    ordered = sorted(shape, key=lambda p: ((p[0] - pts[0][0]) ** 2 + (p[1] - pts[0][1]) ** 2))
    s.paint(set(ordered[: 2 + min(sleeve, 12) * 2]), c["top"])
    hx, hy = hand
    s.paint({(hx, hy), (hx + 1, hy)}, c["skin"], inner_outline=True)


def sparkle(s, x, y, color="#ffe066"):
    for p in ((x, y), (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
        s.put(p[0], p[1], color)
    s.put(x, y, "#ffffff")


def pose(c, name):
    s = Sprite()
    hair_back(s, c)
    body_and_legs(s, c)
    if name == "standing":
        arm(s, c, [(8, 22), (7, 28)], (7, 28))
        draw_glass(s, 23, 25)
        arm(s, c, [(22, 22), (23, 27)], (22, 27))
        head(s, c, "open", "smile")
    elif name == "drinking":
        arm(s, c, [(8, 22), (7, 28)], (7, 28))
        head(s, c, "closed", "none")
        draw_glass(s, 14, 17)
        arm(s, c, [(22, 23), (22, 21)], (19, 20))
        s.paint({(19, 19), (20, 19), (19, 20), (20, 20)}, c["skin"], inner_outline=True)
    elif name == "celebrate":
        arm(s, c, [(8, 22), (4, 16)], (3, 14))
        draw_glass(s, 25, 6)
        arm(s, c, [(21, 22), (26, 16)], (25, 13))
        head(s, c, "closed", "open")
        sparkle(s, 3, 7); sparkle(s, 11, 2); sparkle(s, 29, 20, "#ff9ec7"); sparkle(s, 2, 24, "#8fe3ff")
    hair_tie(s, c)
    return s.finish()


DROPPY = dict(id="droppy", name="Droppy")
DROP_BLUE = "#4cc3ff"
DROP_SHADE = "#2f9de0"


def pose_droppy(name):
    """A friendly water-drop mascot."""
    s = Sprite()
    s.paint(rect(11, 33, 14, 35) | rect(18, 33, 21, 35), DROP_SHADE)  # feet
    body = ellipse(16, 22, 10.5, 10.5)
    for y in range(2, 14):
        half = (y - 1.5) / 12.5 * 7.5
        body |= {(x, y) for x in range(W) if abs(x + 0.5 - 16) <= half}
    s.paint(body, DROP_BLUE)
    s.paint({(x, y) for (x, y) in body if x >= 21 and y >= 16}, DROP_SHADE)
    s.paint({(10, 18), (10, 19), (10, 20), (11, 17), (12, 16), (14, 8), (14, 9)}, "#d9f3ff")

    def arm_to(pts):
        shape = set()
        for i in range(len(pts) - 1):
            shape |= line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 2)
        s.paint(shape, DROP_BLUE, inner_outline=True)

    dark = "#2b1d3a"
    cheeks = ((9, 21), (10, 21), (21, 21), (22, 21))
    if name == "standing":
        arm_to([(7, 24), (5, 29)])
        draw_glass(s, 24, 24)
        arm_to([(23, 24), (24, 28)])
        eyes, mouth = "open", "smile"
    elif name == "drinking":
        arm_to([(7, 24), (5, 29)])
        eyes, mouth = "closed", "none"
    else:
        arm_to([(7, 21), (3, 14)])
        draw_glass(s, 25, 5)
        arm_to([(24, 21), (27, 13)])
        eyes, mouth = "closed", "open"
    for p in cheeks:
        s.put(p[0], p[1], "#ff9aa8")
    if eyes == "open":
        for ex in (11, 19):
            s.paint(rect(ex, 16, ex + 1, 18), dark)
            s.put(ex, 16, "#ffffff")
    else:
        for ex in (10, 19):
            s.put(ex, 18, dark); s.put(ex + 1, 17, dark); s.put(ex + 2, 18, dark)
    if mouth == "smile":
        s.put(15, 22, "#b0475f"); s.put(16, 22, "#b0475f")
    elif mouth == "open":
        s.paint(rect(14, 21, 17, 22), "#8e2f4b")
        s.paint(rect(15, 22, 16, 22), "#ff8aa0")
    if name == "drinking":
        draw_glass(s, 14, 22)
    if name == "celebrate":
        sparkle(s, 3, 8); sparkle(s, 12, 3); sparkle(s, 29, 22, "#ff9ec7"); sparkle(s, 2, 26, "#8fe3ff")
    return s.finish()


def write_character(c):
    folder = os.path.join(ROOT, "characters", c["id"])
    os.makedirs(folder, exist_ok=True)
    for p in ("standing", "drinking", "celebrate"):
        img = pose_droppy(p) if c["id"] == "droppy" else pose(c, p)
        img.save(os.path.join(folder, f"{p}.png"))
    with open(os.path.join(folder, "character.json"), "w") as f:
        json.dump({"name": c["name"]}, f)
        f.write("\n")


# --------------------------------------------------------------------------
# tray + app icons
# --------------------------------------------------------------------------
def drop_pixels(size, pad=1):
    """A water-drop silhouette that fills a size x size square."""
    cx = size / 2
    r = size * 0.34
    cy = size - pad - r - 0.5
    tip = pad + 0.5
    pts = set()
    for y in range(size):
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            in_circle = (px - cx) ** 2 + (py - cy) ** 2 <= r * r
            in_cone = False
            if tip <= py <= cy:
                half = (py - tip) / (cy - tip) * r * 0.95
                in_cone = abs(px - cx) <= half
            if in_circle or in_cone:
                pts.add((x, y))
    return pts


def tray_icon(size, template=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    drop = drop_pixels(size)
    edge = {(x, y) for (x, y) in drop
            if any((x + dx, y + dy) not in drop for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    for (x, y) in drop:
        if template:
            px[x, y] = (0, 0, 0, 255)
        else:
            px[x, y] = hexc("#1b6fb8") if (x, y) in edge else hexc("#4cb8ff")
    if not template:
        # shine
        s = max(1, size // 8)
        for i in range(s * 2):
            x, y = int(size * 0.36), int(size * 0.5) + i
            if (x, y) in drop and (x, y) not in edge:
                px[x, y] = hexc("#d9f3ff")
    return img


def app_icon():
    base = 32
    img = Image.new("RGBA", (base, base), (0, 0, 0, 0))
    px = img.load()
    # rounded sky-blue tile
    for y in range(base):
        for x in range(base):
            inset = 1
            corner = (x < 3 or x > base - 4) and (y < 3 or y > base - 4)
            cut = corner and (min(x, base - 1 - x) + min(y, base - 1 - y)) < 3
            if inset <= x < base - inset and inset <= y < base - inset and not cut:
                px[x, y] = hexc("#bfeaff") if y < 16 else hexc("#9fdcff")
    # big drop with a face
    drop = drop_pixels(24, pad=1)
    ox, oy = 4, 4
    edge = {(x, y) for (x, y) in drop
            if any((x + dx, y + dy) not in drop for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    for (x, y) in drop:
        px[x + ox, y + oy] = hexc("#1b5fa0") if (x, y) in edge else hexc("#4cb8ff")
    for (x, y) in ((7, 13), (7, 14), (7, 15), (8, 12)):
        px[x + ox, y + oy] = hexc("#d9f3ff")
    for ex in (8, 14):
        for ey in (15, 16, 17):
            px[ex + ox, ey + oy] = hexc("#2b1d3a"); px[ex + 1 + ox, ey + oy] = hexc("#2b1d3a")
        px[ex + ox, 15 + oy] = hexc("#ffffff")
    for (x, y) in ((11, 19), (12, 19)):
        px[x + ox, y + oy] = hexc("#2b1d3a")
    for (x, y) in ((6, 18), (7, 18), (16, 18), (17, 18)):
        px[x + ox, y + oy] = hexc("#ff9aa8")
    return img.resize((512, 512), Image.NEAREST)


def main():
    for c in (MOCHI, SUNNY, KAI, LUNA, DROPPY):
        write_character(c)
    assets = os.path.join(ROOT, "assets")
    os.makedirs(assets, exist_ok=True)
    tray_icon(16).save(os.path.join(assets, "tray.png"))
    tray_icon(32).save(os.path.join(assets, "tray@2x.png"))
    tray_icon(16, template=True).save(os.path.join(assets, "trayTemplate.png"))
    tray_icon(32, template=True).save(os.path.join(assets, "trayTemplate@2x.png"))
    app_icon().save(os.path.join(assets, "icon.png"))
    print("assets written")


if __name__ == "__main__":
    main()
