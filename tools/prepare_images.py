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


def on_tile(img, size=TILE, pad=0.11, bg=INK):
    """Кладёт вырезанный объект по центру квадратной плитки."""
    tile = Image.new('RGB', (size, size), bg)
    inner = int(size * (1 - 2 * pad))
    t = img.copy()
    t.thumbnail((inner, inner), Image.LANCZOS)
    tile.paste(t, ((size - t.width) // 2, (size - t.height) // 2), t)
    return tile


def product_square(path, size=720, pad=0.09, black_thr=100, black_hole=95, feather=1.0):
    """
    Фото изделия → белый квадрат с одинаковым полем, чтобы карточки
    выбора в калькуляторе были одного формата.

    Фон белый — обрезаем поля по не-белому и центрируем на белом
    квадрате (совпадает с фоном страницы). Фон чёрный — вырезаем его
    и кладём объект на такой же белый квадрат. Пороги вырезания
    чёрного можно поднять для кадров с рваной тенью.
    """
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    avg = [sum(c[i] for c in corners) // 4 for i in range(3)]

    if min(avg) > 235:                       # белый фон
        arr = np.asarray(im).astype(np.int32)
        lum = arr.min(axis=2)
        mask = lum < 244
        ys, xs = np.where(mask)
        if len(xs):
            m = 8
            box = (max(0, xs.min() - m), max(0, ys.min() - m),
                   min(w, xs.max() + m), min(h, ys.max() + m))
            im = im.crop(box)
        return on_tile(im.convert('RGBA'), size, pad, bg=(255, 255, 255))
    return on_tile(cut_from_black(path, black_thr, black_hole, feather),
                   size, pad, bg=(255, 255, 255))


def photo(path, width):
    """Фото-референс (рука, ухо, шкала) — просто ресайз по ширине."""
    im = Image.open(path).convert('RGB')
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    return im


def stack(paths, width):
    """
    Склеивает части одной шкалы в столбик.

    Шкала цвета в каталоге разрезана на пять кусков (бесцветные,
    почти бесцветные, слабый оттенок, очень слабый, лёгкий цвет).
    В карточке нужна одна картинка, поэтому собираем их в порядке
    шкалы GIA — от D к Z.
    """
    ims = [Image.open(p).convert('RGB') for p in paths]
    ims = [im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
           for im in ims]
    out = Image.new('RGB', (width, sum(im.height for im in ims)), (0, 0, 0))
    y = 0
    for im in ims:
        out.paste(im, (0, y))
        y += im.height
    return out


def save(img, name, quality=84, lossless=False):
    p = os.path.join(OUT, name)
    kw = dict(lossless=True, method=6) if lossless else dict(quality=quality, method=6)
    img.save(p, 'WEBP', **kw)
    return os.path.getsize(p)


def main(src):
    os.makedirs(OUT, exist_ok=True)
    total = 0
    print('%-30s %-12s %8s' % ('файл', 'размер', 'вес'))

    # Диаграммы огранок и плитки-огранки убраны: калькулятор показывает
    # только фото самого изделия (item-*). Схема огранки и подпись сняты
    # по просьбе — оставлена одна фотография на вариант.

    # ── Фото изделия под каждый вариант калькулятора ──
    # ключ = id варианта в pricing.json → исходный файл
    PRODUCTS = {
        'soliter-round':   '18_koltso-soliter_krug_beloe_zoloto_v2',   # гладкий солитер
        'pave-round':      '18_koltso-soliter_v_obsypke_krug_beloe_zoloto',
        # Варианты с фантазийной огранкой сюда не входят: у них
        # общий кадр item-fancy-forms со всеми формами (см. ниже).
        'doroshka':        '24_koltso-dorozhka_krugloe',
        'studs-round':     '29_sergi-pusety_krug_belye',
        'studs-yellow':    '29_sergi-pusety_zheltye_podushka',
        'tennis-bracelet': '35_tennisny_braslet_2ct',
        'tennis-necklace': '38_tennisnye_kolye_tri_tsveta_zolota',
    }
    # Кадры на чёрном фоне с рваной тенью — вырезаем агрессивнее
    BLACK_OPTS = {'soliter-fancy': dict(black_thr=150, black_hole=145, feather=1.6)}
    for vid, name in PRODUCTS.items():
        f = os.path.join(src, name + '.png')
        if not os.path.exists(f):
            print('НЕТ исходника:', name); continue
        img = product_square(f, **BLACK_OPTS.get(vid, {}))
        n = save(img, 'item-%s.webp' % vid)
        total += n
        print('%-30s %-12s %6.0fКБ' % ('item-%s.webp' % vid, '%dx%d' % img.size, n / 1024))

    # ── Фантазийная огранка: не одна форма, а класс форм ──
    # Для таких вариантов показываем общий кадр со всеми 12 формами.
    # Он широкий и с подписями, поэтому в квадрат его не загоняем —
    # иначе текст под камнями станет нечитаемым.
    f = os.path.join(src, '08_ogranka_vse_formy.png')
    if os.path.exists(f):
        n = save(photo(f, 1100), 'item-fancy-forms.webp')
        total += n
        print('%-30s %-12s %6.0fКБ' % ('item-fancy-forms.webp', 'широкий', n / 1024))
    else:
        print('НЕТ исходника: 08_ogranka_vse_formy')

    # ── Фото-референс размера по типу изделия ──
    SIZES = {
        'size-ring':     ('17_proportsii_razmery_brilliantov_na_ruke', 900),
        'size-studs':    ('28_proportsii_razmery_na_ushe', 900),
        'size-bracelet': ('34_proportsii_braslety_karatnost', 900),
        'size-necklace': ('39_tennisnoe_kolye_na_shee_v2', 900),
    }
    for out_name, (name, width) in SIZES.items():
        f = os.path.join(src, name + '.png')
        if not os.path.exists(f):
            print('НЕТ исходника:', name); continue
        n = save(photo(f, width), out_name + '.webp')
        total += n
        print('%-30s %6.0fКБ' % (out_name + '.webp', n / 1024))

    # ── Четыре характеристики камня (4C) ──
    # Ровно четыре карточки: вес, огранка, цвет, чистота.
    EDU = {
        'edu-carat':   ('07_sravnenie_vesa_brilliantov_sergi-pusety', 700),
        'edu-cut':     ('08_ogranka_vse_formy', 1100),
        'edu-clarity': ('12_chistota_shkala_vklyucheniya', 900),
    }
    for out_name, (name, width) in EDU.items():
        f = os.path.join(src, name + '.png')
        if not os.path.exists(f):
            print('НЕТ исходника:', name); continue
        n = save(photo(f, width), out_name + '.webp')
        total += n
        print('%-30s %6.0fКБ' % (out_name + '.webp', n / 1024))

    # Цвет — пять кусков шкалы, склеиваем в порядке от D к Z
    COLOR = ['09_tsvet_bestsvetnye_DEF', '09_tsvet_pochti_bestsvetnye_GHIJ',
             '09_tsvet_slaby_ottenok_KLM', '09_tsvet_ochen_slaby_ottenok_NOPQR',
             '09_tsvet_legky_tsvet_N-Z']
    parts = [os.path.join(src, c + '.png') for c in COLOR]
    missing = [c for c, p in zip(COLOR, parts) if not os.path.exists(p)]
    if missing:
        print('НЕТ исходников шкалы цвета:', missing)
    else:
        n = save(stack(parts, 885), 'edu-color.webp')
        total += n
        print('%-30s %6.0fКБ (склейка из %d частей)' % ('edu-color.webp', n / 1024, len(parts)))

    print('\nвсего: %.0f КБ в %d файлах' % (total / 1024, len(os.listdir(OUT))))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else
         '/Users/yuliashabashova/Library/CloudStorage/Dropbox/Bots/website_diamonds/pdf')
