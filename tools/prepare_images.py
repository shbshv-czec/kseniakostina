#!/usr/bin/env python3
"""
Готовит иллюстрации из выгрузки печатного каталога для сайта.

Два типа исходников — и два разных способа обрезки:

1. Диаграммы огранок. Это штриховой рисунок: белые линии на чёрном.
   Яркость превращается в прозрачность, линии перекрашиваются в цвет
   текста сайта. Получается чистый контур, который ложится на светлый фон.

2. Фотографии колец и серёг. Белый металл и бриллианты сняты на чёрном.
   На светлом фоне они теряют контраст и почти исчезают, поэтому вырезать
   их «на просвет» бессмысленно. Вместо этого фон убирается заливкой от
   краёв (тёмные грани внутри камня при этом остаются на месте), а объект
   кладётся на плитку фирменного тёмного цвета. Мелкие огрехи обрезки на
   ней не видны, а камни читаются как в каталоге.

Запуск:  python3 tools/prepare_images.py <папка-с-выгрузкой>
"""

import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import label

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets/img/cuts')
INK = (42, 39, 36)          # --fg-1, фон тёмных плиток
TILE = 560                  # сторона плитки, 2x от показа

# файл-слаг → название огранки так, как оно приходит из разбора канала
CUTS = {
    'asher': 'Ашер', 'baget': 'Багет', 'emerald': 'Изумрудная', 'grusha': 'Груша',
    'krug': 'Круг', 'markiz': 'Маркиз', 'oval': 'Овал', 'podushka': 'Кушон',
    'printsessa': 'Принцесса', 'radiant': 'Радиант', 'serdtse': 'Сердце',
    'trilliant': 'Триллиант',
}


def cut_from_black(path, thr=100, hole_lum=95, feather=1.0):
    """Убирает чёрный фон заливкой от краёв. Дырки внутри объекта, если они
    тёмные, тоже считаются фоном — иначе внутри дужки кольца остаётся клякса."""
    im = Image.open(path).convert('RGB')
    arr = np.asarray(im).astype(np.int32)
    lum = (arr[..., 0] * 299 + arr[..., 1] * 587 + arr[..., 2] * 114) // 1000

    lbl, _ = label(lum <= thr)
    border = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    border.discard(0)
    obj = ~np.isin(lbl, list(border))

    holes, n = label(~obj)
    for i in range(1, n + 1):
        m = holes == i
        if m.any() and lum[m].mean() <= hole_lum:
            obj[m] = False

    alpha = Image.fromarray((obj * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(feather))
    out = im.convert('RGBA')
    out.putalpha(alpha)
    return out.crop(out.getbbox())


def line_art(path, ink=INK, fill=(232, 228, 221)):
    """
    Диаграмма огранки → прозрачное изображение с линиями цвета ink.

    Исходники неоднородны, поэтому две развилки:
    • фон определяется по медиане рамки, а не по углам: у «груши» по краю
      идёт светлая полоса, и углы врут;
    • «маркиз» нарисован не контуром, а белой заливкой с чёрными гранями.
      Такую картинку нельзя переводить в контур напрямую — получится
      чёрное пятно. Для неё берём силуэт, заливаем его светлым тоном
      и поверх проявляем тёмные грани.
    """
    im = Image.open(path).convert('L')
    # У части исходников по краю идёт тонкая рамка — срезаем поля,
    # рисунок в них всё равно не заходит.
    m = int(min(im.size) * 0.03)
    im = im.crop((m, m, im.width - m, im.height - m))
    w, h = im.size
    arr = np.asarray(im).astype(np.int32)
    frame = np.r_[arr[:20].ravel(), arr[-20:].ravel(), arr[:, :20].ravel(), arr[:, -20:].ravel()]
    dark_bg = np.median(frame) < 128

    ink_mask = arr if dark_bg else 255 - arr          # яркое = рисунок
    filled = (ink_mask > 60)
    holes, n = label(~filled)
    border = set(holes[0, :]) | set(holes[-1, :]) | set(holes[:, 0]) | set(holes[:, -1])
    border.discard(0)
    silhouette = filled | ~np.isin(holes, list(border))

    # Доля закрашенного внутри силуэта: у контурных рисунков она мала,
    # у заливки — близка к единице.
    solid = filled[silhouette].mean() if silhouette.any() else 0

    if solid > 0.55:
        rgb = np.zeros((h, w, 3), dtype='uint8')
        rgb[...] = fill
        lines = ink_mask < 110                        # грани внутри заливки
        for c in range(3):
            rgb[..., c] = np.where(lines, ink[c], fill[c])
        alpha = (silhouette * 255).astype('uint8')
        out = Image.fromarray(np.dstack([rgb, alpha]), 'RGBA')
    else:
        a = Image.fromarray(np.clip((ink_mask - 26) * 255 // 174, 0, 255).astype('uint8'))
        out = Image.new('RGBA', (w, h), ink + (0,))
        out.putalpha(a)

    return out.crop(out.getbbox())


def on_tile(img, size=TILE, pad=0.11):
    """Кладёт вырезанный объект по центру квадратной тёмной плитки."""
    tile = Image.new('RGB', (size, size), INK)
    inner = int(size * (1 - 2 * pad))
    t = img.copy()
    t.thumbnail((inner, inner), Image.LANCZOS)
    tile.paste(t, ((size - t.width) // 2, (size - t.height) // 2), t)
    return tile


def save(img, name, quality=84, lossless=False):
    p = os.path.join(OUT, name)
    kw = dict(lossless=True, method=6) if lossless else dict(quality=quality, method=6)
    img.save(p, 'WEBP', **kw)
    return os.path.getsize(p)


def main(src):
    os.makedirs(OUT, exist_ok=True)
    total = 0
    print('%-30s %-12s %8s' % ('файл', 'размер', 'вес'))

    for slug in sorted(CUTS):
        # диаграмма — прозрачная, для светлого фона
        f = os.path.join(src, '08_ogranka_%s_diagramma.png' % slug)
        if os.path.exists(f):
            d = line_art(f)
            # Показываются мелко (значок огранки ~110px), 300px хватает
            # с запасом. В рисунке есть зернистость, поэтому lossless
            # здесь только раздувает вес — берём щадящее сжатие.
            d.thumbnail((300, 300), Image.LANCZOS)
            n = save(d, '%s-diagram.webp' % slug, quality=86)
            total += n
            print('%-30s %-12s %6.0fКБ' % (slug + '-diagram.webp', '%dx%d' % d.size, n / 1024))

        # изделие — на тёмной плитке
        for suffix in ('koltso', 'sergi'):
            f = os.path.join(src, '08_ogranka_%s_%s.png' % (slug, suffix))
            if not os.path.exists(f):
                continue
            t = on_tile(cut_from_black(f))
            n = save(t, '%s.webp' % slug)
            total += n
            print('%-30s %-12s %6.0fКБ' % (slug + '.webp', '%dx%d' % t.size, n / 1024))
            break

    # дополнительные иллюстрации: наглядность размера и шкала цвета
    extras = [
        ('07_sravnenie_vesa_brilliantov_sergi-pusety.png', 'size-ear.webp', 900),
        ('01_ruka_koltso-soliter_i_tennisny_braslet_chb.png', 'size-hand.webp', 900),
        ('10_ruka_koltso_s_zheltym_brilliantom.png', 'hand-yellow.webp', 1000),
        ('06_brilliant_v_pintsete_4c.png', 'tweezers.webp', 800),
    ]
    for name, out_name, width in extras:
        f = os.path.join(src, name)
        if not os.path.exists(f):
            continue
        im = Image.open(f).convert('RGB')
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        n = save(im, out_name)
        total += n
        print('%-30s %-12s %6.0fКБ' % (out_name, '%dx%d' % im.size, n / 1024))

    print('\nвсего: %.0f КБ в %d файлах' % (total / 1024, len(os.listdir(OUT))))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else
         '/Users/yuliashabashova/Library/CloudStorage/Dropbox/Bots/website_diamonds/pdf')
