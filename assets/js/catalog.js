/* ============================================================
   Каталог камней.

   Данные лежат в assets/data/catalog.json и собираются скриптом
   tools/parse_telegram.py из канала-витрины. Бэкенда нет: фильтрация,
   сортировка и подгрузка целиком в браузере.

   Состояние фильтров живёт в адресе страницы, поэтому ссылку с
   подобранной выборкой можно переслать в личку.
   ============================================================ */
(function () {
  'use strict';

  var TG = 'https://t.me/kseniadiamond';
  var PAGE = 60;                    // сколько карточек показывать за раз
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Порядок бюджетов задан вручную: он смысловой, а не алфавитный
  var BUDGETS = ['до 5 000', '5 000–10 000', '10 000–30 000', 'от 30 000'];

  // Цвет заглушки под камень — пока нет фотографий, карточка всё равно
  // читается, а цвет остаётся главной осью выбора
  var TINT = {
    'Бриллиант': ['#EAE8E4', '#C7C4BE'], 'Жёлтый бриллиант': ['#F5E4B2', '#DBBF74'],
    'Изумруд': ['#C0DAC5', '#7EAD8B'], 'Сапфир': ['#C4D3E7', '#7B96BE'],
    'Рубин': ['#EAC5C5', '#BF7F7F'], 'Шпинель': ['#ECC8CF', '#C38599'],
    'Турмалин параиба': ['#BFE8ED', '#6EC4D1'], 'Турмалин': ['#CCE1D4', '#8EBEA7'],
    'Танзанит': ['#D0C9E7', '#998EC3'], 'Гранат': ['#E4C4BD', '#B67D6F'],
    'Перидот': ['#DDE5B5', '#AEBD71'], 'Спессартин': ['#F1D5B5', '#D2A167'],
    'Рубеллит': ['#F0C9D7', '#CD86A3'], 'Аквамарин': ['#C8E4E9', '#85BDCA'],
    'Топаз': ['#EEDDBC', '#CCAE74'], 'Гелиодор': ['#F0E4B7', '#D1BD71'],
    'Цаворит': ['#C7E1BF', '#84B47E'], 'Александрит': ['#D7CEE1', '#A191BB'],
    'Апатит': ['#C3E1E3', '#7DBABF'],
  };
  var TINT_DEFAULT = ['#DCD6CB', '#BFB6A6'];

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  var all = [];
  var view = [];
  var shown = 0;
  var state = { stone: [], budget: [], type: [], stock: false, sort: 'default' };

  /* ---------- Склонение ---------- */
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function money(v) {
    return '$' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  /* ---------- Адрес страницы ---------- */
  function readUrl() {
    var p = new URLSearchParams(location.search);
    ['stone', 'budget', 'type'].forEach(function (k) {
      var v = p.get(k);
      state[k] = v ? v.split('|').filter(Boolean) : [];
    });
    state.stock = p.get('stock') === '1';
    state.sort = p.get('sort') || 'default';
  }

  function writeUrl() {
    var p = new URLSearchParams();
    ['stone', 'budget', 'type'].forEach(function (k) {
      if (state[k].length) p.set(k, state[k].join('|'));
    });
    if (state.stock) p.set('stock', '1');
    if (state.sort !== 'default') p.set('sort', state.sort);
    var q = p.toString();
    history.replaceState(null, '', q ? '?' + q : location.pathname);
  }

  /* ---------- Отбор и сортировка ---------- */
  // По умолчанию показываем всё, включая проданное: витрина за полтора года
  // — это и есть доказательство, что камни такого уровня реально проходят
  // через руки. Прячет проданное только кнопка «Только в наличии».
  // Виды изделия у позиции. У сета их несколько (сам «Сет» плюс каждая
  // составляющая), поэтому он находится по любому из своих фильтров.
  // Старые данные без поля types подстраховываем одиночным type.
  function typesOf(item) { return item.types || (item.type ? [item.type] : []); }

  function match(item) {
    if (state.stock && !item.in_stock) return false;
    if (state.stone.length && state.stone.indexOf(item.stone) < 0) return false;
    if (state.budget.length && state.budget.indexOf(item.budget) < 0) return false;
    if (state.type.length && !typesOf(item).some(function (t) {
      return state.type.indexOf(t) >= 0;
    })) return false;
    return true;
  }

  var SORTS = {
    // «Сначала в наличии» — состояние по умолчанию: сток важнее новизны
    default: function (a, b) { return (b.in_stock - a.in_stock) || (b.id - a.id); },
    cheap: function (a, b) { return num(a.price, Infinity) - num(b.price, Infinity); },
    costly: function (a, b) { return num(b.price, -1) - num(a.price, -1); },
    carat: function (a, b) { return num(b.carat, -1) - num(a.carat, -1); },
  };
  function num(v, fallback) { return typeof v === 'number' ? v : fallback; }

  function apply() {
    view = all.filter(match).sort(SORTS[state.sort] || SORTS.default);
    shown = 0;
    $('#grid').innerHTML = '';
    renderCount();
    renderChips();
    more();
    $('#empty').hidden = view.length > 0;
    $('#more').hidden = view.length === 0;
    $('#reset').hidden = !isFiltered();
    writeUrl();
  }

  function isFiltered() {
    return state.stone.length || state.budget.length || state.type.length ||
           state.stock || state.sort !== 'default';
  }

  /* ---------- Отрисовка ---------- */
  function renderCount() {
    var n = view.length;
    var s = view.filter(function (i) { return i.in_stock; }).length;
    $('#count').innerHTML = '<b>' + n + '</b> ' +
      plural(n, 'позиция', 'позиции', 'позиций') +
      (n ? ' · ' + s + ' в наличии' : '');
  }

  function card(item) {
    var li = document.createElement('li');
    li.className = 'card';

    var name = item.stone || 'Камень';
    if (item.cut) name += ', ' + item.cut.toLowerCase();

    var media = document.createElement('div');
    media.className = 'card__media';
    if (item.photo) {
      var img = document.createElement('img');
      img.src = '../' + item.photo;
      img.alt = name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 600; img.height = 600;
      media.appendChild(img);
    } else {
      var tint = TINT[item.stone] || TINT_DEFAULT;
      var ph = document.createElement('div');
      ph.className = 'card__ph';
      ph.style.setProperty('--c1', tint[0]);
      ph.style.setProperty('--c2', tint[1]);
      ph.innerHTML = '<span></span>';
      ph.firstChild.textContent = item.stone || '—';
      media.appendChild(ph);
    }
    // Плашка есть у каждой карточки. Канал делит посты ровно надвое:
    // «📦 В наличии» и «На заказ», — и без второй плашки половина каталога
    // выглядела просто карточкой без пометки, будто данных не хватило.
    media.insertAdjacentHTML('beforeend', item.in_stock
      ? '<span class="card__badge card__badge--stock">В наличии</span>'
      : '<span class="card__badge card__badge--order">На заказ</span>');
    li.appendChild(media);

    var spec = [];
    if (item.carat) spec.push(item.carat + ' ct');
    // «Отдельный камень» в подписи не повторяем — заголовок карточки
    // это и так камень. У сета вид, наоборот, полезен.
    if (item.type && item.type !== 'Отдельный камень') spec.push(item.type.toLowerCase());

    var body = document.createElement('div');
    body.className = 'card__body';

    var h = document.createElement('h2');
    h.className = 'card__title';
    h.textContent = name;
    body.appendChild(h);

    if (spec.length) {
      var p = document.createElement('p');
      p.className = 'card__spec';
      p.textContent = spec.join(' · ');
      body.appendChild(p);
    }

    var price = document.createElement('p');
    if (item.price) {
      price.className = 'card__price';
      price.textContent = money(item.price);
      if (item.per_carat) {
        var small = document.createElement('small');
        small.textContent = ' за карат';
        price.appendChild(small);
      }
    } else {
      price.className = 'card__price card__price--ask';
      price.textContent = 'Цена по запросу';
    }
    body.appendChild(price);

    var actions = document.createElement('div');
    actions.className = 'card__actions';

    var ask = document.createElement('button');
    ask.type = 'button';
    ask.className = 'card__ask';
    ask.textContent = 'Спросить про камень';
    ask.addEventListener('click', function () { askAbout(item, name); });
    actions.appendChild(ask);

    var link = document.createElement('a');
    link.className = 'card__link';
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Пост в канале →';
    actions.appendChild(link);

    body.appendChild(actions);
    li.appendChild(body);
    return li;
  }

  function more() {
    var frag = document.createDocumentFragment();
    var next = Math.min(shown + PAGE, view.length);
    for (var i = shown; i < next; i++) frag.appendChild(card(view[i]));
    $('#grid').appendChild(frag);
    shown = next;
    $('#more').hidden = shown >= view.length && view.length === 0;
    $('#sentinel').hidden = shown >= view.length;
  }

  /* ---------- Кнопка «Спросить про камень» ----------
     Подставить текст в личное сообщение Telegram ссылкой нельзя —
     платформа этого не умеет. Поэтому копируем заготовку в буфер и
     открываем диалог: человеку остаётся вставить и отправить. */
  function askAbout(item, name) {
    var parts = ['Здравствуйте! Интересует позиция №' + item.id + ' — ' + name];
    if (item.carat) parts.push(item.carat + ' ct');
    if (item.price) parts.push(money(item.price) + (item.per_carat ? ' за карат' : ''));
    var text = parts.join(', ') + '.\n' + item.url;

    copy(text).then(function (ok) {
      toast(ok ? 'Запрос скопирован — вставьте его в диалог' : 'Откройте диалог и напишите про позицию №' + item.id);
      window.open(TG, '_blank', 'noopener');
    });
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; },
                                                      function () { return false; });
    }
    // Запасной путь для http и старых мобильных браузеров
    return new Promise(function (res) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      res(ok);
    });
  }

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-shown'); }, 3200);
  }

  /* ---------- Фильтры ---------- */
  function counts(field) {
    // Считаем по выборке, где сняты ограничения этого же поля, — иначе
    // числа схлопнутся до нуля, как только выбрана одна позиция
    var saved = state[field];
    state[field] = [];
    var base = all.filter(match);
    state[field] = saved;
    var map = {};
    base.forEach(function (i) {
      // Тип многозначен (сет считается в каждой своей категории),
      // остальные поля — по одному значению.
      var vals = field === 'type' ? typesOf(i) : (i[field] ? [i[field]] : []);
      vals.forEach(function (v) { map[v] = (map[v] || 0) + 1; });
    });
    return map;
  }

  function chip(field, value, n, tint) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-pressed', String(state[field].indexOf(value) >= 0));
    if (tint) {
      var dot = document.createElement('span');
      dot.className = 'chip__dot';
      dot.style.background = tint[1];
      b.appendChild(dot);
    }
    b.appendChild(document.createTextNode(value));
    if (n != null) {
      var s = document.createElement('span');
      s.className = 'chip__n';
      s.textContent = n;
      b.appendChild(s);
    }
    b.addEventListener('click', function () {
      var i = state[field].indexOf(value);
      if (i >= 0) state[field].splice(i, 1); else state[field].push(value);
      apply();
    });
    return b;
  }

  function renderChips() {
    var cs = counts('stone'), cb = counts('budget'), ct = counts('type');

    var stones = Object.keys(cs).sort(function (a, b) { return cs[b] - cs[a]; });
    fill('#f-stone', stones.map(function (v) { return chip('stone', v, cs[v], TINT[v] || TINT_DEFAULT); }));

    fill('#f-budget', BUDGETS.filter(function (v) { return cb[v]; })
      .map(function (v) { return chip('budget', v, cb[v]); }));

    // Украшения — по частоте, а «Сет» и «Отдельный камень» всегда в конце:
    // это не виды украшений, а особые корзины, и мешать их в общий ряд
    // по числу позиций сбивает — иначе «Отдельный камень» (самый частый)
    // встал бы первым, вперёд колец.
    var TAIL = { 'Сет': 1, 'Отдельный камень': 2 };
    var types = Object.keys(ct).sort(function (a, b) {
      return (TAIL[a] || 0) - (TAIL[b] || 0) || ct[b] - ct[a];
    });
    fill('#f-type', types.map(function (v) { return chip('type', v, ct[v]); }));
  }

  function fill(sel, nodes) {
    var host = $(sel);
    host.innerHTML = '';
    nodes.forEach(function (n) { host.appendChild(n); });
  }

  function toggle(sel, key) {
    var b = $(sel);
    b.setAttribute('aria-pressed', String(state[key]));
    b.addEventListener('click', function () {
      state[key] = !state[key];
      b.setAttribute('aria-pressed', String(state[key]));
      apply();
    });
  }

  /* ---------- Запуск ---------- */
  function init(data) {
    all = data;
    readUrl();

    toggle('#t-stock', 'stock');

    var sort = $('#sort');
    sort.value = state.sort;
    sort.addEventListener('change', function () { state.sort = sort.value; apply(); });

    $('#reset').addEventListener('click', function () {
      state = { stone: [], budget: [], type: [], stock: false, sort: 'default' };
      $('#t-stock').setAttribute('aria-pressed', 'false');
      sort.value = 'default';
      apply();
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting && shown < view.length) more(); });
      }, { rootMargin: '600px' }).observe($('#sentinel'));
    }

    apply();
  }

  fetch('../assets/data/catalog.json')
    .then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(init)
    .catch(function () {
      $('#count').textContent = '';
      $('#empty').hidden = false;
      $('#empty').querySelector('h2').textContent = 'Не удалось загрузить каталог';
      $('#empty').querySelector('p').textContent =
        'Обновите страницу или напишите — покажу наличие лично.';
    });
})();
