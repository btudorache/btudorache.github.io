"""Checks the owl (owl-model.js) against Román Díaz's own drawings.

Origami Essence (2009) diagrams the owl on pp. 17-18. For each figure that shows the
whole model (2 to 13), this takes the model's flat state at that point
(owl-states.mjs), fits it onto the drawing with one scale and one offset, and scores
how well they overlap (intersection over union): the paper's outline, and the part of
it that shows the grey side (charcoal here).

    python tools/check-owl.py BOOK.pdf [--images DIR]

The book is not in this repo. The drawings are read from its scanned pages, so the
crop boxes below fit one particular scan (pages of 1700 x 2340 pixels, the owl on the
PDF's 4th and 5th pages); another copy needs its own. Figures 14 to 23 are close-ups
or 3D, and were compared by overlaying the model's edges instead. Needs Node,
PyMuPDF, Pillow and NumPy.
"""
import argparse
import json
import os
import subprocess

import fitz
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = {17: 3, 18: 4}          # book page -> PDF page index
# figure -> (book page, crop box in pixels of the page's scan)
S = 1700 / 1453
BOXES = {n: (17, tuple(round(v * S) for v in box)) for n, box in {
    2: (560, 705, 900, 1050), 3: (975, 670, 1315, 1025), 4: (290, 995, 630, 1345), 5: (645, 1055, 1000, 1345),
    6: (1020, 1090, 1230, 1375), 7: (195, 1345, 435, 1700), 8: (475, 1405, 740, 1700), 9: (750, 1430, 960, 1700),
    10: (1055, 1390, 1290, 1700)}.items()}
BOXES.update({n: (18, tuple(round(v * S) for v in box)) for n, box in {
    11: (316, 110, 578, 410), 12: (590, 125, 870, 430), 13: (872, 140, 1120, 430)}.items()})
DARK = 140                      # a drawn line
GREY = 218                      # the grey side's halftone, averaged, is darker than this


def page_image(pdf, index):
    img = fitz.open(pdf)[index].get_images(full=True)[0]
    pix = fitz.Pixmap(fitz.open(pdf), img[0])
    if pix.n > 3: pix = fitz.Pixmap(fitz.csRGB, pix)
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)


def drawn(crop):
    """The scanned figure's paper and its grey part, as boolean masks."""
    a = np.array(crop.convert('L')).astype(float)
    h, w = a.shape
    dark = a < DARK
    # the page around the paper: flood from the border through anything not a line
    bg = Image.fromarray(np.where(dark, 0, 255).astype(np.uint8)).copy()   # fromarray is read-only
    for seed in [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]:
        if bg.getpixel(seed) == 255: ImageDraw.floodfill(bg, seed, 128)
    # drop arrows and the like (thin), keep the piece under the middle
    pm = Image.fromarray(((np.array(bg) != 128) * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(7)).copy()
    ys, xs = np.nonzero(np.array(pm))
    c = np.argmin((ys - h / 2) ** 2 + (xs - w / 2) ** 2)
    ImageDraw.floodfill(pm, (int(xs[c]), int(ys[c])), 128)
    paper = np.array(pm) == 128
    # grey: the mean brightness of the non-line pixels around each point
    m = (~dark).astype(float)
    num = np.array(Image.fromarray((a * m).astype(np.uint8)).filter(ImageFilter.BoxBlur(5))).astype(float)
    den = np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.BoxBlur(5))).astype(float) / 255
    grey = paper & (num / np.maximum(den, 1e-3) < GREY)
    return paper, grey, dark


def score(crop, pieces, image=None):
    paper, grey, dark = drawn(crop)
    h, w = paper.shape
    ys, xs = np.nonzero(paper)
    dx0, dx1, dy0, dy1 = xs.min(), xs.max(), ys.min(), ys.max()
    P = np.array([p for pc in pieces for p in pc['pts']])
    (ex0, ey0), (ex1, ey1) = P.min(0), P.max(0)
    s = ((dx1 - dx0) / (ex1 - ex0) + (dy1 - dy0) / (ey1 - ey0)) / 2
    fit = lambda p: ((p[0] - (ex0 + ex1) / 2) * s + (dx0 + dx1) / 2, -(p[1] - (ey0 + ey1) / 2) * s + (dy0 + dy1) / 2)
    im = Image.new('L', (w, h), 0)
    dr = ImageDraw.Draw(im)
    for pc in pieces:
        dr.polygon([fit(p) for p in pc['pts']], fill=1 if pc['side'] == 'front' else 2)
    e = np.array(im)
    # the fills stop short of the drawn lines; leave a band along them out of the scores
    core = ~(np.array(Image.fromarray((dark * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))) > 0)
    def iou(x, y):
        x, y = x & core, y & core
        return None if not (x | y).any() else (x & y).sum() / (x | y).sum()
    if image:
        pal = np.array([[255, 255, 255], [240, 220, 120], [120, 120, 130]], np.uint8)
        d = np.where(grey, 2, np.where(paper, 1, 0))
        diff = np.where((d != e)[..., None], [220, 40, 40], np.where((d > 0)[..., None], [200, 200, 200], [255, 255, 255])).astype(np.uint8)
        row = np.full((h, 3 * w + 20, 3), 255, np.uint8)
        row[:, :w], row[:, w + 10:2 * w + 10], row[:, 2 * w + 20:] = pal[d], pal[e], diff
        Image.fromarray(row).save(image)
    return iou(paper, e > 0), iou(grey, e == 2)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('pdf', help='your copy of Origami Essence')
    ap.add_argument('--images', metavar='DIR', help='also write drawing | model | difference images here')
    args = ap.parse_args()
    if args.images:
        os.makedirs(args.images, exist_ok=True)
    model = json.loads(subprocess.check_output(['node', os.path.join(HERE, 'owl-states.mjs')], text=True))
    pages = {p: page_image(args.pdf, i) for p, i in PAGES.items()}
    fmt = lambda v: ' none' if v is None else f'{v:.3f}'
    print('figure  after  outline   grey')
    for n in sorted(BOXES):
        page, box = BOXES[n]
        f = model['figures'][str(n)]
        o, g = score(pages[page].crop(box), f['pieces'], args.images and os.path.join(args.images, f'figure-{n}.png'))
        print(f"{n:6}  {f['stages']:5}  {fmt(o):>7}  {fmt(g):>5}")
    print('validate():', '; '.join(model['problems']) or 'every flat state is one real paper can take')


if __name__ == '__main__':
    main()
