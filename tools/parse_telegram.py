#!/usr/bin/env python3
"""
Собирает catalog.json из выгрузки канала-витрины t.me/diamondbabecloset.

Запуск:
    python3 tools/parse_telegram.py "Messages_Ювелирный Гардероб.csv"

Что делает: читает CSV-выгрузку, разбирает посты по правилам ниже и пишет
assets/data/catalog.json. Ксения продолжает публиковать посты как привыкла —
менять в её работе ничего не нужно.

Ручные исправления: если разбор ошибся, не правьте catalog.json — он
перезаписывается. Правьте assets/data/overrides.json, он накладывается
поверх автоматики (см. OVERRIDES ниже).
"""

import csv
import io
import json
import os
import re
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets/data/catalog.json')
OVERRIDES = os.path.join(ROOT, 'assets/data/overrides.json')
STOCK_DIR = os.path.join(ROOT, 'assets/stock')
CHANNEL = 'https://t.me/diamondbabecloset'

# Цена выше этого порога — почти наверняка слипшиеся цифры при экспорте
# («1 550 000$» превращается в 11550000). Такие позиции идут на проверку.
PRICE_SANITY_LIMIT = 3_000_000

# ── Справочники ───────────────────────────────────────────────────────────

# Хештег камня → название. Порядок важен: если в посте несколько камней,
# выигрывает первый по этому списку. Поэтому цветные стоят выше бриллиантов:
# в посте «Кольцо с изумрудом и бриллиантами» главный камень — изумруд.
STONE_TAGS = [
    ('Параибы',          'Турмалин параиба'),
    ('Александрит',      'Александрит'),
    ('Цаворит',          'Цаворит'),
    ('Спессартин',       'Спессартин'),
    ('Рубеллит',         'Рубеллит'),
    ('Гелиодор',         'Гелиодор'),
    ('Аквамарин',        'Аквамарин'),
    ('Апатит',           'Апатит'),
    ('Топаз',            'Топаз'),
    ('Перидот',          'Перидот'),
    ('Гранат',           'Гранат'),
    ('Танзанит',         'Танзанит'),
    ('Шпинель',          'Шпинель'),
    ('Рубины',           'Рубин'),
    ('Рубин',            'Рубин'),
    ('Сапфиры',          'Сапфир'),
    ('Сапфир',           'Сапфир'),
    ('Изумруды',         'Изумруд'),
    ('Изумруд',          'Изумруд'),
    ('Турмалин',         'Турмалин'),
    ('ЖелтыеБриллианты', 'Жёлтый бриллиант'),
    ('Бриллианты',       'Бриллиант'),
]

TYPE_TAGS = [
    ('ТеннисныеБраслеты', 'Теннисный браслет'),
    ('ТеннисныйБраслет',  'Теннисный браслет'),
    ('Браслеты',          'Браслет'),
    ('Подвески',          'Подвеска'),
    ('Пусеты',            'Пусеты'),
    ('Серьги',            'Серьги'),
    ('Кольца',            'Кольцо'),
    ('Колье',             'Колье'),
]

# Порядок фиксированный — он же порядок кнопок в фильтре
BUDGET_TAGS = [
    ('До5000',        'до 5 000'),
    ('5000До10000',   '5 000–10 000'),
    ('10000До30000',  '10 000–30 000'),
    ('От30000',       'от 30 000'),
]

# Огранки: английские из постов + русские варианты
CUTS = [
    (r'\bcushion\b|\bкушон\w*',                'Кушон'),
    (r'\boval\b|\bовал\w*',                    'Овал'),
    (r'\bpear\b|\bгруш\w+',                    'Груша'),
    (r'\bround\b|\bкруг\w*\b|\bкругл\w+',      'Круг'),
    (r'\bemerald\b|\bизумрудн\w+\s+огранк',    'Изумрудная'),
    (r'\bradiant\b|\bрадиант\w*',              'Радиант'),
    (r'\bmarquise\b|\bмаркиз\w*',              'Маркиз'),
    (r'\bheart\b|\bсердц\w+|\bсердце\b',       'Сердце'),
    (r'\bprincess\b|\bпринцесс\w*',            'Принцесса'),
    (r'\basscher\b|\bашер\w*',                 'Ашер'),
    (r'\btrilliant\b|\bтриллиант\w*',          'Триллиант'),
    (r'\boctagon\b|\bоктагон\w*',              'Октагон'),
    (r'\bbaguette\b|\bбагет\w*',               'Багет'),
    (r'сахарн\w+\s+голов\w+',                  'Сахарная голова'),
]


def clean(text):
    """Снимает разметку Telegram и схлопывает пробелы."""
    t = text.replace('\\n', ' ')
    t = re.sub(r'[*_]{1,3}', ' ', t)          # **жирный**, __курсив__
    t = t.replace(' ', ' ')
    return re.sub(r'\s+', ' ', t).strip()


def find_tags(raw):
    """Хештеги без хвостовых подчёркиваний: #Параибы____ → Параибы."""
    return [t.rstrip('_') for t in re.findall(r'#([A-Za-zА-Яа-яЁё0-9_]+)', raw)]


def pick(pairs, tags):
    tagset = set(tags)
    for tag, value in pairs:
        if tag in tagset:
            return value
    return None


def item_types(tags):
    """Все виды изделия в посте, в порядке приоритета TYPE_TAGS и без
    повторов (теннисный и обычный браслет мапятся разными тегами, но это
    один вид). Пусто — значит изделия нет, продаётся сам камень."""
    tagset = set(tags)
    out = []
    for tag, value in TYPE_TAGS:
        if tag in tagset and value not in out:
            out.append(value)
    return out


def classify(tags):
    """Возвращает (основной тип, список типов для фильтра).

    Один вид — как раньше. Два и больше — это сет: он и «Сет», и каждая
    своя составляющая, поэтому находится по любому из фильтров. Ни одного —
    отдельный камень."""
    kinds = item_types(tags)
    if len(kinds) >= 2:
        return 'Сет', ['Сет'] + kinds
    if len(kinds) == 1:
        return kinds[0], kinds
    return 'Отдельный камень', ['Отдельный камень']


def parse_price(text):
    """
    Возвращает (цена, за_карат, по_запросу, замечание).

    Доллар встречается и до числа ($2640), и после (19300$), внутри числа
    бывают пробелы (43 500$, $11 875). Берём первое совпадение.
    """
    if re.search(r'по\s+запрос|цена\s+по\s+запрос', text, re.I):
        return None, False, True, None

    # Число — либо группы по три цифры через разделитель (43 500, $2,422,
    # $11 875), либо сплошное (8100). Разделителем бывают пробел, узкий
    # пробел и запятая. Требование ровно трёх цифр после разделителя важно:
    # иначе «$4,775 3.79ct» слиплось бы в 47753.
    NUM = r'\d{1,3}(?:[  ,]\d{3})+|\d+'
    # Для числа ПЕРЕД долларом (19300$) требуем, чтобы слева не было буквы
    # или слэша: иначе цифра из грейда «VS1 $2300» ловится как цена 1,
    # а настоящие $2300 после неё уже съедены.
    values = []
    for before, after in re.findall(r'\$\s?(%s)|(?<![\w/])(%s)\s?\$' % (NUM, NUM), text):
        digits = re.sub(r'[^\d]', '', before or after)
        if digits:
            values.append(int(digits))
    if not values:
        return None, False, True, 'цена не найдена'

    price = values[0]
    note = None
    if price > PRICE_SANITY_LIMIT:
        return None, False, True, 'цена %d выше разумного предела, вероятно слиплись цифры' % price
    if len(values) > 1:
        note = 'в посте несколько цен (%s), взята первая' % ', '.join(map(str, values))

    per_carat = bool(re.search(r'за\s+карат|за\s+ct', text, re.I))
    return price, per_carat, False, note


def parse_carat(text):
    """Первое число перед ct или «карат». Десятичная часть через точку или запятую."""
    m = re.search(r'(\d+(?:[.,]\d+)?)\s*(?:ct\b|карат|карата|каратов)', text, re.I)
    if not m:
        return None
    try:
        return round(float(m.group(1).replace(',', '.')), 2)
    except ValueError:
        return None


def parse_cut(text):
    """
    Побеждает огранка, упомянутая в тексте раньше, а не первая по словарю.
    В посте «огранки Сердце 5,05 ct … и Груша 0,53 ct» главный камень —
    сердце, груша лишь дополняет.
    """
    low = text.lower()
    best = None
    for pattern, name in CUTS:
        m = re.search(pattern, low, re.I)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), name)
    return best[1] if best else None


def parse_stone_from_text(text):
    """Запасной путь, если хештега камня нет."""
    low = text.lower()
    if 'параиба' in low:
        return 'Турмалин параиба'
    for _, name in STONE_TAGS:
        if name.lower().split()[-1] in low:
            return name
    return None


def stone_list(tags, text):
    """Все камни поста, в порядке STONE_TAGS и без повторов. В одном посте
    иногда продают несколько разных камней (апатиты и топазы) — тогда он
    находится по любому из них. Первый в списке — основной, он идёт на
    заголовок и цвет карточки."""
    tagset = set(tags)
    out = []
    for tag, name in STONE_TAGS:
        if tag in tagset and name not in out:
            out.append(name)
    # #Параибы и #Турмалин на одном посте — это параиба, а не два камня:
    # параиба и есть разновидность турмалина.
    if 'Турмалин параиба' in out and 'Турмалин' in out:
        out.remove('Турмалин')
    # Бриллиантовая обсыпка — отделка цветного камня, а не второй товар.
    # Если в посте есть цветной камень, бриллианты (и белые, и жёлтые) в
    # список не идут: иначе фильтр «Бриллиант» собрал бы все цветные с
    # обсыпкой. Основным бриллиант всё равно не был — в STONE_TAGS он
    # последний. Пара из двух бриллиантов (белый+жёлтый) остаётся: там
    # оба и есть предмет поста.
    DIAMONDS = ('Бриллиант', 'Жёлтый бриллиант')
    if any(s not in DIAMONDS for s in out):
        out = [s for s in out if s not in DIAMONDS]
    if not out:
        one = parse_stone_from_text(text)
        if one:
            out = [one]
    return out


def build(csv_path):
    with io.open(csv_path, encoding='utf-8-sig') as fh:
        rows = list(csv.DictReader(fh, delimiter=';'))

    have_photo = set()
    if os.path.isdir(STOCK_DIR):
        for f in os.listdir(STOCK_DIR):
            stem, ext = os.path.splitext(f)
            if ext.lower() in ('.webp', '.jpg', '.jpeg', '.png') and stem.isdigit():
                have_photo.add(int(stem))

    items, skipped, review = [], 0, []
    for row in rows:
        raw = row.get('message') or ''
        if raw.strip() == 'MediaMessage':
            skipped += 1
            continue

        text = clean(raw)
        if len(text) < 15:
            skipped += 1
            continue

        tags = find_tags(raw)
        stones = stone_list(tags, text)
        price, per_carat, by_request, note = parse_price(text)
        mid = int(row['message_id'])
        main_type, type_list = classify(tags)

        item = {
            'id': mid,
            'stone': stones[0] if stones else None,
            'stones': stones,
            'type': main_type,
            'types': type_list,
            'cut': parse_cut(text),
            'carat': parse_carat(text),
            'price': price,
            'per_carat': per_carat,
            'by_request': by_request,
            'budget': pick(BUDGET_TAGS, tags),
            'in_stock': bool(re.search(r'в\s+наличии', text, re.I)),
            'sold': False,
            'photo': 'assets/stock/%d.webp' % mid if mid in have_photo else None,
            'url': '%s/%d' % (CHANNEL, mid),
            'date': row['date'][:10],
        }
        if note:
            review.append({'id': mid, 'note': note, 'text': text[:160]})
        items.append(item)

    # Ручные исправления поверх автоматики
    if os.path.exists(OVERRIDES):
        with io.open(OVERRIDES, encoding='utf-8') as fh:
            patches = json.load(fh)
        by_id = {it['id']: it for it in items}
        applied = 0
        for patch in patches:
            target = by_id.get(patch.get('id'))
            if target:
                target.update({k: v for k, v in patch.items() if k != 'id'})
                # Правка камня или типа руками, без списка, — приводим список
                # в соответствие, иначе фильтр и карточка разойдутся.
                if 'type' in patch and 'types' not in patch:
                    target['types'] = [target['type']]
                if 'stone' in patch and 'stones' not in patch:
                    target['stones'] = [target['stone']] if target['stone'] else []
                applied += 1
        print('применено ручных исправлений: %d из %d' % (applied, len(patches)))

    items.sort(key=lambda x: (-int(x['in_stock']), -x['id']))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(items, fh, ensure_ascii=False, separators=(',', ':'))

    return items, skipped, review


def report(items, skipped, review):
    n = len(items)
    def pct(field):
        got = sum(1 for i in items if i.get(field) not in (None, False))
        return '%3d%% (%d из %d)' % (round(100 * got / n), got, n)

    print('\nразобрано позиций: %d, пропущено служебных: %d' % (n, skipped))
    print('  камень            ', pct('stone'))
    print('  бюджет            ', pct('budget'))
    print('  вес               ', pct('carat'))
    print('  цена              ', pct('price'))
    # Тип теперь есть всегда: изделие, «Сет» или «Отдельный камень».
    jew = sum(1 for i in items if i['type'] not in ('Отдельный камень', 'Сет'))
    sets = sum(1 for i in items if i['type'] == 'Сет')
    stones = sum(1 for i in items if i['type'] == 'Отдельный камень')
    print('  изделий           ', '%3d%% (%d из %d)' % (round(100 * jew / n), jew, n))
    print('  сетов             ', sets)
    print('  отдельных камней  ', stones)
    print('  огранка           ', pct('cut'))
    print('  в наличии         ', sum(1 for i in items if i['in_stock']))
    print('  фото на диске     ', sum(1 for i in items if i['photo']))
    print('  цена по запросу   ', sum(1 for i in items if i['by_request']))
    print('  цена за карат     ', sum(1 for i in items if i['per_carat']))
    if review:
        print('\nна ручную проверку: %d' % len(review))
        for r in review[:12]:
            print('  #%d — %s' % (r['id'], r['note']))
    print('\nзаписано: %s' % OUT)


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'Messages.csv')
    if not os.path.exists(src):
        sys.exit('не найдена выгрузка: %s' % src)
    report(*build(src))
