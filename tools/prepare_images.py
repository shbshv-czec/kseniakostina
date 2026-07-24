#!/usr/bin/env python3
"""
Готовит иллюстрации из выгрузки печатного каталога для сайта.

Фотографии изделий обрезаются по самому изделию и кладутся на белый —
он совпадает с фоном страницы. Почти вся выгрузка снята на белом, но
попадаются кадры на чёрном: там белый металл на просвет не вырезать,
поэтому фон убирается заливкой от краёв (тёмные грани внутри камня при
этом остаются на месте).

Фото-референсы (рука, ухо, запястье, шея, шкалы 4C) не обрезаются вовсе,
им нужен только ресайз по ширине.

Запуск:  python3 tools/prepare_images.py <папка-с-выгрузкой>
"""

import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import label

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets/img/cuts')


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


def product_photo(path, max_w=720, max_h=560, black_thr=100, black_hole=95, feather=1.0):
    """
    Фото изделия → кадр, обрезанный по самому изделию, на белом фоне.

    Пропорции сохраняем, в квадрат не загоняем: исходники — групповые
    кадры, у половины из них соотношение сторон вроде 4:1. В квадрате
    такая полоса занимала бы четверть высоты, а остальное было бы
    пустым белым полем. Разные пропорции значит разные `width`/`height`
    в разметке — их подставляет скрипт калькулятора (словарь ITEM_BOX).

    Фон белый — обрезаем поля по не-белому. Фон чёрный — вырезаем его
    заливкой от краёв и кладём объект на белый. Пороги вырезания чёрного
    можно поднять для кадров с рваной тенью.
    """
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    avg = [sum(c[i] for c in corners) // 4 for i in range(3)]

    if min(avg) > 235:                       # белый фон
        arr = np.asarray(im).astype(np.int32)
        lum = arr.min(axis=2)
        ys, xs = np.where(lum < 244)
        if len(xs):
            m = 8
            im = im.crop((max(0, xs.min() - m), max(0, ys.min() - m),
                          min(w, xs.max() + m), min(h, ys.max() + m)))
    else:
        obj = cut_from_black(path, black_thr, black_hole, feather)
        im = Image.new('RGB', obj.size, (255, 255, 255))
        im.paste(obj, (0, 0), obj)

    im.thumbnail((max_w, max_h), Image.LANCZOS)
    return im


def photo(path, width, keep=1.0):
    """Фото-референс (рука, ухо, шкала) — ресайз по ширине.
    keep < 1 срезает низ кадра: у части исходников там пустой фон."""
    im = Image.open(path).convert('RGB')
    if keep < 1:
        im = im.crop((0, 0, im.width, round(im.height * keep)))
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    return im



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
    #
    # Все исходники — групповые кадры на белом («_gruppa»): одно и то же
    # изделие в разных цветах золота либо в разных формах огранки. Своё
    # фото есть теперь у каждого варианта, включая фантазийные: раньше они
    # делили общий кадр форм огранки, потому что отдельных снимков не было.
    PRODUCTS = {
        'soliter-round':   '18_koltso-soliter_krug_gruppa',
        'pave-round':      '18_koltso-soliter_v_obsypke_krug_gruppa',
        'soliter-fancy':   '22_koltso-soliter_fantazi_gruppa',
        'pave-fancy':      '22_koltso-soliter_v_obsypke_fantazi_gruppa',
        'soliter-fancy-yellow': '20_koltso-soliter_fantazi_zhelty_gruppa',
        'pave-fancy-yellow':    '20_koltso-soliter_v_obsypke_fantazi_zhelty_gruppa',
        'doroshka':        '24_koltso-dorozhka_gruppa',
        'studs-round':     '29_sergi-pusety_krug_gruppa',
        'studs-fancy':     '31_sergi-pusety_fantazi_gruppa',
        'studs-yellow':    '29_sergi-pusety_zheltye_gruppa',
        'tennis-bracelet': '35_tennisny_braslet_gruppa',
        'tennis-necklace': '38_tennisnoe_kolye_gruppa',
    }
    # Размеры печатаем: их же надо проставить в ITEM_BOX калькулятора,
    # иначе при переключении исполнения вёрстка скачет, пока грузится файл.
    for vid, name in PRODUCTS.items():
        f = os.path.join(src, name + '.png')
        if not os.path.exists(f):
            print('НЕТ исходника:', name); continue
        img = product_photo(f)
        n = save(img, 'item-%s.webp' % vid)
        total += n
        print('%-30s %-12s %6.0fКБ' % ('item-%s.webp' % vid, '%dx%d' % img.size, n / 1024))

    # ── Фото-референс размера по типу изделия ──
    # Третье число — доля кадра по высоте, которую оставляем. У браслетов
    # нижняя четверть исходника — пустой тёмный фон: рядом с ползунком
    # она только растягивает ряд. Остальные кадры берём целиком.
    SIZES = {
        'size-ring':     ('17_proportsii_razmery_brilliantov_na_ruke', 900, 1.0),
        'size-studs':    ('28_proportsii_razmery_na_ushe', 900, 1.0),
        'size-bracelet': ('34_proportsii_braslety_karatnost', 900, 0.78),
        'size-necklace': ('39_tennisnoe_kolye_na_shee_v2', 900, 1.0),
    }
    for out_name, (name, width, keep) in SIZES.items():
        f = os.path.join(src, name + '.png')
        if not os.path.exists(f):
            print('НЕТ исходника:', name); continue
        img = photo(f, width, keep)
        n = save(img, out_name + '.webp')
        total += n
        print('%-30s %-12s %6.0fКБ' % (out_name + '.webp', '%dx%d' % img.size, n / 1024))

    # ── Четыре характеристики камня (4C) ──
    # Ровно четыре карточки: вес, огранка, цвет, чистота.
    EDU = {
        'edu-carat':   ('07_sravnenie_vesa_brilliantov_sergi-pusety', 700),
        'edu-cut':     ('08_ogranka_vse_formy', 1100),
        'edu-color':   ('09_tsvet_shkala_polnaya', 900),
        'edu-clarity': ('12_chistota_shkala_vklyucheniya', 900),
    }
    for out_name, (name, width) in EDU.items():
        f = os.path.join(src, name + '.png')
        if not os.path.exists(f):
            print('НЕТ исходника:', name); continue
        img = photo(f, width)
        n = save(img, out_name + '.webp')
        # Размер печатаем, чтобы его же проставить в width/height разметки —
        # иначе вёрстка скачет при загрузке.
        total += n
        print('%-30s %-12s %6.0fКБ' % (out_name + '.webp', '%dx%d' % img.size, n / 1024))


    print('\nвсего: %.0f КБ в %d файлах' % (total / 1024, len(os.listdir(OUT))))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else
         '/Users/yuliashabashova/Library/CloudStorage/Dropbox/Bots/website_diamonds/pdf')
