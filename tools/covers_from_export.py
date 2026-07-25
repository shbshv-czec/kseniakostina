#!/usr/bin/env python3
"""
Обложки каталога из выгрузки канала (Telegram Desktop → Export → JSON).

У постов-витрины медиа — почти всегда вертикальное видео: камень крутят в
руке под лампой. Заглушка Telegram для обложки не годится (320 px, мыло),
поэтому кадр берём из самого ролика. Половина кадров смазана движением, так
что из середины ролика пробуем несколько и оставляем самый резкий (дисперсия
Лапласиана). Кадр обрезаем в квадрат — карточка каталога квадратная.

Привязка «пост → файл» берётся из result.json: у каждого сообщения свой id,
он же — id позиции в catalog.json. Имя файла (IMG_1234.MOV) роли не играет.

Результат: assets/stock/<id>.webp. parse_telegram.py подхватывает их сам,
поэтому после прогона надо пересобрать каталог:

    python3 tools/covers_from_export.py "<папка выгрузки>"
    python3 tools/parse_telegram.py "Messages_Ювелирный Гардероб.csv"

Существующие обложки не перезаписываются: несколько выгрузок за разные даты
складываются в одну папку. Ключ --force пересобирает всё заново.
"""

import argparse
import os
import subprocess
import tempfile

import numpy as np
from PIL import Image
from scipy.ndimage import convolve

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STOCK = os.path.join(ROOT, 'assets/stock')

# Кадр берём выше геометрического центра: камень в этих роликах обычно сидит
# в средне-нижней части кадра, и якорь 0.40 держит его в квадрате.
CROP_TOP = 0.40
BOX = 600
LAPLACE = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]])


def sharpness(im):
    g = np.asarray(im.convert('L'), dtype=np.float64)
    return convolve(g, LAPLACE, mode='reflect').var()


def duration(path):
    r = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=nk=1:nw=1', path],
        capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def best_frame(path, n=7):
    """Самый резкий кадр из средних 60% ролика."""
    dur = duration(path)
    if dur <= 0:
        return None
    best, best_sc = None, -1.0
    with tempfile.TemporaryDirectory() as td:
        for i in range(n):
            t = dur * (0.2 + 0.6 * i / (n - 1))
            f = os.path.join(td, '%d.jpg' % i)
            subprocess.run(
                ['ffmpeg', '-y', '-ss', str(t), '-i', path, '-frames:v', '1',
                 f, '-loglevel', 'error'], check=False)
            if not os.path.exists(f):
                continue
            im = Image.open(f).convert('RGB')
            sc = sharpness(im)
            if sc > best_sc:
                best, best_sc = im.copy(), sc
    return best


def square(im, top_frac=CROP_TOP):
    w, h = im.size
    s = min(w, h)
    left = (w - s) // 2
    top = int((h - s) * top_frac) if h > w else (h - s) // 2
    return im.crop((left, top, left + s, top + s))


def cover(msg, export_dir):
    """Кадр-обложку для одного сообщения. None — если файла нет."""
    rel = msg.get('file') or msg.get('photo')
    if not rel or rel.startswith('('):        # '(File not included…)'
        return None
    path = os.path.join(export_dir, rel)
    if not os.path.exists(path):
        return None
    if 'photo' in msg:                        # фото-пост — кадр не нужен
        im = Image.open(path).convert('RGB')
    else:                                     # video_file / animation
        im = best_frame(path)
    if im is None:
        return None
    return square(im).resize((BOX, BOX), Image.LANCZOS)


def text_of(msg):
    t = msg.get('text')
    if isinstance(t, list):
        return ''.join(p if isinstance(p, str) else p.get('text', '') for p in t)
    return t or ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('export', help='папка выгрузки Telegram (с result.json)')
    ap.add_argument('--force', action='store_true',
                    help='пересобрать уже существующие обложки')
    args = ap.parse_args()

    import json
    with open(os.path.join(args.export, 'result.json'), encoding='utf-8') as fh:
        data = json.load(fh)

    os.makedirs(STOCK, exist_ok=True)
    posts = [m for m in data['messages']
             if m.get('type') == 'message' and text_of(m).strip()]

    made = skipped = missing = 0
    for m in posts:
        mid = m['id']
        out = os.path.join(STOCK, '%d.webp' % mid)
        if os.path.exists(out) and not args.force:
            skipped += 1
            continue
        im = cover(m, args.export)
        if im is None:
            missing += 1
            print('  нет файла: пост', mid)
            continue
        im.save(out, 'WEBP', quality=82, method=6)
        made += 1
        print('  %d.webp  %dКБ' % (mid, os.path.getsize(out) // 1024))

    print('\nпостов в выгрузке: %d' % len(posts))
    print('собрано обложек:   %d' % made)
    print('уже были (пропуск): %d' % skipped)
    print('без файла:          %d' % missing)
    print('\nдальше: python3 tools/parse_telegram.py "Messages_Ювелирный Гардероб.csv"')


if __name__ == '__main__':
    main()
