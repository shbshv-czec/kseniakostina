/* ============================================================
   Калькулятор изделия.

   Цифры берутся из assets/data/pricing.json — это таблицы печатного
   каталога, они обновляются вручную примерно раз в квартал.

   Важно: здесь цена ориентировочная, в отличие от каталога, где она
   настоящая, за конкретный существующий камень. Смешивать нельзя,
   поэтому оговорка видна всегда, а не прячется под кат.

   Между табличными точками считаем линейной интерполяцией.
   За границами таблиц не экстраполируем: там слишком многое зависит
   от конкретного камня, и выдуманная цифра подорвала бы доверие
   к остальным. Вместо неё — предложение посчитать лично.
   ============================================================ */
(function () {
  'use strict';

  var TG = 'https://t.me/kseniadiamond';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var data, product, variant, grade, weight;

  function money(v) {
    return '$' + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  function toHundreds(v) { return Math.round(v / 100) * 100; }

  /* ---------- Интерполяция ---------- */
  function lerp(rows, col, w) {
    var lo = null, hi = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i][0] <= w) lo = rows[i];
      if (rows[i][0] >= w && hi === null) hi = rows[i];
    }
    if (!lo || !hi) return null;                    // за пределами таблицы
    if (lo === hi) return val(lo[col]);
    var k = (w - lo[0]) / (hi[0] - lo[0]);
    var a = val(lo[col]), b = val(hi[col]);
    if (Array.isArray(a)) return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    return a + (b - a) * k;
  }
  function val(v) { return v; }

  function series(v, w) {
    // Возвращает вилку [низ, верх] по выбранному качеству либо по обоим,
    // если качество не выбрано
    var cols = v.grades.map(function (_, i) { return i + 1; });
    var pick = grade === 'any' ? cols : [v.grades.indexOf(grade) + 1];
    var vals = [];
    for (var i = 0; i < pick.length; i++) {
      var r = lerp(v.rows, pick[i], w);
      if (r === null) return null;
      if (Array.isArray(r)) { vals.push(r[0]); vals.push(r[1]); }
      else vals.push(r);
    }
    return [Math.min.apply(null, vals), Math.max.apply(null, vals)];
  }

  function mm(v, w) {
    if (v.mm) {
      var rows = v.rows.map(function (r, i) { return [r[0], v.mm[i]]; });
      return lerp(rows, 1, w);
    }
    if (v.cut === 'krug') {
      // Диаметр круглого бриллианта растёт как корень кубический из веса.
      // Опорная точка — 1 ct = 6.5 мм, из её же каталога.
      var per = product.id === 'studs' ? w / 2 : w;   // у пусет вес пары
      return per > 0 ? 6.5 * Math.pow(per, 1 / 3) : null;
    }
    return null;
  }

  /* ---------- Отрисовка ---------- */
  function render() {
    var span = series(variant, weight);
    var out = $('#result');

    $('#r-weight').textContent = weight.toFixed(2).replace(/\.?0+$/, '') + ' ct';
    $('#r-item').textContent = product.name + ' · ' + variant.name;
    $('#r-grade').textContent = grade === 'any' ? variant.grades.join(' / ') : grade;
    $('#r-lead').textContent = data.lead_time;

    var d = mm(variant, weight);
    var vis = $('#size-vis');
    if (d) {
      var mmText = d.toFixed(1).replace('.', ',') + ' мм';
      $('#r-mm').textContent = mmText;
      $('#r-mm-row').hidden = false;
      // 1 мм ≈ 3.8 px: камень на экране примерно в натуральную величину
      var px = Math.max(10, Math.round(d * 3.8));
      $('#size-stone').style.width = px + 'px';
      $('#size-stone').style.height = px + 'px';
      $('#size-mm').textContent = 'Диаметр камня — ' + mmText +
        (product.id === 'studs' ? ' (каждый в паре)' : '');
      // Подпись есть там, где кадр показывает камень на человеке.
      // Для браслета и колье такой фразы в каталоге нет — не выдумываем.
      $('#size-cap').textContent = SIZE_CAPTION[product.id] || '';
      $('#size-cap').hidden = !SIZE_CAPTION[product.id];
      vis.hidden = false;
    } else {
      $('#r-mm-row').hidden = true;
      vis.hidden = true;
    }

    syncUrl();

    if (!span) {
      out.classList.add('is-out');
      $('#r-price').textContent = 'Посчитаю индивидуально';
      $('#r-price-note').textContent = 'Такой вес выходит за рамки классических ' +
        'позиций. Напишите мне — подберу камень под ваш запрос и назову точную стоимость.';
      $('#r-discuss').textContent = 'Написать Ксении';
      return;
    }

    out.classList.remove('is-out');
    $('#r-discuss').textContent = 'Обсудить заказ';
    var lo = toHundreds(span[0]), hi = toHundreds(span[1]);
    $('#r-price').textContent = lo === hi ? money(lo) : money(lo) + ' — ' + money(hi);
    // Подписи под ценой нет: заголовок над ней уже говорит
    // «Ориентировочная стоимость». Строка остаётся только там, где
    // цены нет вовсе и нужно объяснить почему.
    $('#r-price-note').textContent = '';
  }

  /* ---------- Ссылка на выбранное ---------- */
  /* Весь выбор помещается в адрес, поэтому ссылка открывается в том же
     состоянии и никакого бэкенда для этого не нужно. Адрес обновляется
     через replaceState: каждое нажатие кнопки не должно превращаться
     в отдельный шаг истории, иначе «назад» пришлось бы жать двадцать раз. */
  function syncUrl() {
    history.replaceState(null, '', location.pathname +
      '?v=' + encodeURIComponent(variant.id) +
      '&g=' + encodeURIComponent(grade) +
      '&w=' + weight);
  }

  function findVariant(id) {
    for (var i = 0; i < data.products.length; i++) {
      var v = data.products[i].variants.filter(function (x) { return x.id === id; })[0];
      if (v) return { product: data.products[i], variant: v };
    }
    return null;
  }

  function restoreFromUrl() {
    // Каждое значение проверяем по данным: id исполнения может исчезнуть
    // при следующем обновлении прайса, и тогда лучше открыть калькулятор
    // как обычно, чем показать несуществующее сочетание.
    var p = new URLSearchParams(location.search);
    var found = p.get('v') && findVariant(p.get('v'));
    if (!found) return false;
    product = found.product;
    variant = found.variant;

    var g = p.get('g');
    if (g === 'any' || variant.grades.indexOf(g) >= 0) grade = g;

    var w = parseFloat(p.get('w'));
    var ws = variant.rows.map(function (r) { return r[0]; });
    if (w >= Math.min.apply(null, ws) && w <= Math.max.apply(null, ws)) weight = w;
    return true;
  }

  var copyTimer;
  function copyLink() {
    var btn = $('#r-copy');
    copy(location.href).then(function (ok) {
      btn.textContent = ok ? '✓ Ссылка скопирована' : 'Не удалось скопировать';
      btn.classList.toggle('is-done', ok);
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () {
        btn.textContent = 'Скопировать ссылку';
        btn.classList.remove('is-done');
      }, 2600);
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

  /* ---------- Элементы выбора ---------- */
  function chips(host, items, current, onPick) {
    host.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = it.name;
      b.setAttribute('aria-pressed', String(it.id === current));
      b.addEventListener('click', function () { onPick(it); });
      host.appendChild(b);
    });
  }

  function setProduct(p) {
    product = p;
    variant = p.variants[0];
    afterVariant();
    chips($('#f-product'), data.products, p.id, setProduct);
    renderVariants();
  }

  // Расшифровка обозначения качества. Показывается одна — та, что
  // относится к выбранной кнопке: три подписи разом читались как сплошной
  // текст, и было неясно, какая к какой кнопке. Для качеств, которых здесь
  // нет (жёлтые бриллианты), подписи не придумываем — строка просто пустая.
  var GRADE_NOTE = {
    'any': 'Показывает вилку между обоими вариантами',
    'F/VS1': 'Бесцветный, с очень мелкими включениями',
    'I/VS2': 'Почти бесцветный, с очень мелкими включениями',
    'Y-Z': 'Некоторые камни в цвете Y-Z имеют очень красивый жёлтый оттенок ' +
      'и могут быть разумной альтернативой фантазийным',
    'Y-Z/VS2': 'Некоторые камни в цвете Y-Z имеют очень красивый жёлтый оттенок ' +
      'и могут быть разумной альтернативой фантазийным',
    'Fancy Yellow': 'Насыщенный жёлтый, фантазийная категория цвета',
  };

  function renderGradeNote() {
    var note = GRADE_NOTE[grade] || '';
    var p = $('#grade-note');
    p.textContent = note;
    p.hidden = !note;
  }

  // Размеры всех кадров. Пропорции разные — от полосы 5:1 до портрета,
  // поэтому размер проставляется в атрибуты, иначе при переключении
  // исполнения вёрстка скачет, пока грузится файл. Числа печатает
  // tools/prepare_images.py, менять их надо вместе.
  var IMG = {
    'item-soliter-round':        [720, 346],
    'item-pave-round':           [720, 364],
    'item-soliter-fancy':        [720, 175],
    'item-pave-fancy':           [720, 166],
    'item-soliter-fancy-yellow': [720, 205],
    'item-pave-fancy-yellow':    [720, 207],
    'item-doroshka':             [641, 560],
    'item-studs-round':          [720, 134],
    'item-studs-fancy':          [583, 560],
    'item-studs-yellow':         [720, 180],
    'item-tennis-bracelet':      [579, 560],
    'size-ring':                 [900, 981],
    'size-studs':                [900, 720],
    'worn-doroshka':             [900, 1350],
    'worn-bracelet':             [900, 1350],
    'worn-necklace':             [900, 1550],
    'worn-necklace-2':           [900, 1351],
  };

  // Пара кадров под ползунком: слева и справа. Второго может не быть.
  // У браслета и колье схемы каратности нет: у браслета справа стоит
  // групповой кадр с подписанными каратами, у колье оба кадра — на
  // человеке, потому что размер камня там ни о чём не говорит.
  var PAIR = {
    'soliter-round':        ['item-soliter-round',        'size-ring'],
    'soliter-fancy':        ['item-soliter-fancy',        'size-ring'],
    'soliter-fancy-yellow': ['item-soliter-fancy-yellow', 'size-ring'],
    'pave-round':           ['item-pave-round',           'size-ring'],
    'pave-fancy':           ['item-pave-fancy',           'size-ring'],
    'pave-fancy-yellow':    ['item-pave-fancy-yellow',    'size-ring'],
    // У дорожки вместо схемы каратности — кольца на руках: схема
    // сравнивает размеры одиночных камней, а тут дорожка из мелких
    // по всему кольцу, и сравнивать нечего.
    'doroshka':             ['item-doroshka',             'worn-doroshka'],
    'studs-round':          ['item-studs-round',          'size-studs'],
    'studs-fancy':          ['item-studs-fancy',          null],
    'studs-yellow':         ['item-studs-yellow',         'size-studs'],
    'tennis-bracelet':      ['worn-bracelet',             'item-tennis-bracelet'],
    'tennis-necklace':      ['worn-necklace',             'worn-necklace-2'],
  };

  // Подпись к кадру для тех, кто не видит картинок. У кадров изделия
  // она собирается из названия исполнения, поэтому здесь только общие.
  var ALT = {
    'size-ring': 'Сравнение размеров бриллиантов на руке: от 0,5 до 3 карат',
    'size-studs': 'Сравнение размеров бриллиантов на ухе: от 0,5 до 3 карат',
    'worn-doroshka': 'Кольца-дорожки на руках',
    'worn-bracelet': 'Теннисные браслеты на руке',
    'worn-necklace': 'Теннисное колье на шее',
    'worn-necklace-2': 'Теннисное колье на шее',
    'item-tennis-bracelet': 'Теннисные браслеты разной каратности: 2, 3 и 5,7 карата',
  };

  function setPhoto(el, name) {
    // Кадра может не быть — тогда прячем и не грузим ничего лишнего.
    el.parentNode.hidden = !name;
    if (!name) return;
    el.src = '../assets/img/cuts/' + name + '.webp';
    var box = IMG[name];
    if (box) { el.width = box[0]; el.height = box[1]; }
    el.alt = ALT[name] || (product.name + ', ' + variant.name);
  }

  // Подпись под кружком в натуральную величину. Есть только там, где
  // кадр показывает камень на человеке.
  var SIZE_CAPTION = {
    ring: 'Так камень смотрится на пальце',
    studs: 'Так камень смотрится в ухе',
  };

  // Фраза огранки для изделий с единственным исполнением
  var CUT_PHRASE = {
    krug: 'Круглые бриллианты', oval: 'Фантазийная огранка',
    grusha: 'Фантазийная огранка', podushka: 'Огранка кушон',
  };

  // Список форм фантазийной огранки — её же перечень из каталога.
  // Круга здесь нет: он не фантазийный.
  var FANCY_SHAPES = 'Подушка, радиант, принцесса, ашер, сердце, ' +
    'триллиант, овал, груша, эмеральд, маркиз, багет.';

  function uniq(list) {
    return list.filter(function (v, i) { return list.indexOf(v) === i; });
  }

  function pick(id) {
    variant = product.variants.filter(function (v) { return v.id === id; })[0];
    afterVariant();
    renderVariants();
  }

  // Оси выбора, сверху вниз. Ряд показывается, только когда на этой оси
  // при уже сделанном выборе есть из чего выбирать: у кольца-дорожки
  // одна огранка, у круглых бриллиантов один цвет.
  var AXES = [
    { key: 'family',     field: '#variant-field', row: '#f-variant' },
    { key: 'cut_name',   field: '#cut-field',     row: '#f-cut' },
    { key: 'color_name', field: '#color-field',   row: '#f-color' },
  ];

  function matches(v, fixed) {
    return Object.keys(fixed).every(function (k) { return v[k] === fixed[k]; });
  }

  function pickAxis(i, value) {
    // Оси выше выбранной остаются как есть, сама ось меняется. Из
    // подходящих вариантов берём тот, что сохраняет больше прежних
    // значений на осях ниже: переключение «солитер → в обсыпке» не
    // должно молча возвращать круглую, если смотрели жёлтую фантазийную.
    var fixed = {};
    for (var j = 0; j < i; j++) fixed[AXES[j].key] = variant[AXES[j].key];
    fixed[AXES[i].key] = value;

    var best = null, bestScore = -1;
    product.variants.filter(function (v) { return matches(v, fixed); })
      .forEach(function (v) {
        var s = 0;
        for (var j = i + 1; j < AXES.length; j++) {
          if (v[AXES[j].key] === variant[AXES[j].key]) s++;
        }
        if (s > bestScore) { bestScore = s; best = v; }
      });
    if (best) pick(best.id);
  }

  function hideAxes() {
    AXES.forEach(function (a) { $(a.field).hidden = true; });
  }

  function renderVariants() {
    // Когда исполнение одно (браслет, колье), выбирать нечего — кнопку
    // прячем, а её содержание показываем строкой, чтобы не создавать
    // ощущение обрезанного выбора. Разные веса при этом остаются
    // за ползунком ниже.
    if (product.variants.length < 2) {
      hideAxes();
      $('#variant-field').hidden = false;
      $('#l-variant').hidden = true;
      $('#f-variant').hidden = true;
      var solo = $('#variant-solo');
      solo.hidden = false;
      solo.textContent = (CUT_PHRASE[variant.cut] || variant.name) +
        ', ' + variant.name;
      return;
    }
    hideAxes();
    $('#variant-field').hidden = false;
    $('#l-variant').hidden = false;
    $('#f-variant').hidden = false;
    $('#variant-solo').hidden = true;

    // Разложить выбор по осям получается только там, где они проставлены
    // у всех вариантов. У пусет «жёлтые бриллианты» — не огранка, осей
    // из этого не выходит, и остаётся один ряд с названиями.
    if (!product.variants.every(function (v) { return v.family; })) {
      chips($('#f-variant'),
        product.variants.map(function (v) { return { id: v.id, name: v.name }; }),
        variant.id, function (it) { pick(it.id); });
      return;
    }

    var fixed = {};
    AXES.forEach(function (a, i) {
      var opts = uniq(product.variants.filter(function (v) { return matches(v, fixed); })
        .map(function (v) { return v[a.key]; }));
      fixed[a.key] = variant[a.key];
      $(a.field).hidden = opts.length < 2;
      if (opts.length < 2) return;
      chips($(a.row), opts.map(function (o) { return { id: o, name: o }; }),
        variant[a.key], function (it) { pickAxis(i, it.id); });
    });

    var fancy = variant.cut_name === 'Фантазийная';
    $('#cut-note').textContent = FANCY_SHAPES;
    $('#cut-note').hidden = !fancy;
    $('#side-note').hidden = !fancy;
  }

  function afterVariant() {
    // Качество: «любое» даёт честную вилку по данным, а не выдуманный разброс
    var opts = [{ id: 'any', name: 'Любое' }].concat(
      variant.grades.map(function (g) { return { id: g, name: g }; }));
    if (variant.grades.length < 2) { grade = variant.grades[0]; }
    else if (!opts.some(function (o) { return o.id === grade; })) { grade = 'any'; }

    $('#grade-field').hidden = variant.grades.length < 2;
    if (variant.grades.length >= 2) {
      chips($('#f-grade'), opts, grade,
        function (it) { grade = it.id; afterVariant(); render(); });
      renderGradeNote();
    }

    var ws = variant.rows.map(function (r) { return r[0]; });
    var min = Math.min.apply(null, ws), max = Math.max.apply(null, ws);
    var slider = $('#weight');
    slider.min = min; slider.max = max;
    slider.step = max - min > 6 ? 0.1 : 0.05;
    if (weight === undefined || weight < min || weight > max) weight = ws[Math.floor(ws.length / 2)];
    slider.value = weight;
    $('#weight-label').textContent = (product.weight_label || variant.weight_label || 'Вес камня');

    // Табличные точки под ползунком: показывают опорные веса каталога
    // (между ними идёт интерполяция) и заодно служат кнопками — попасть
    // ползунком точно в 8,3 ct трудно, а кликом легко.
    var ticks = $('#range-ticks');
    ticks.innerHTML = '';
    ws.forEach(function (w) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tick';
      b.textContent = String(w).replace('.', ',');
      b.setAttribute('aria-pressed', String(w === weight));
      b.addEventListener('click', function () {
        weight = w;
        slider.value = w;
        updateWeightLabel();
        markTicks();
        render();
      });
      ticks.appendChild(b);
    });
    updateWeightLabel();
    markTicks();

    // Пара кадров под ползунком. Когда правого нет, левый занимает
    // половину ряда, а не растягивается во всю ширину.
    var pair = PAIR[variant.id] || [];
    setPhoto($('#pic-left'), pair[0]);
    setPhoto($('#pic-right'), pair[1]);
    $('#preview-row').classList.toggle('is-solo', !pair[1]);
    render();
  }

  function markTicks() {
    // Точка «нажата» только когда вес попал ровно в неё
    var ticks = $('#range-ticks').children;
    for (var i = 0; i < ticks.length; i++) {
      ticks[i].setAttribute('aria-pressed',
        String(parseFloat(ticks[i].textContent.replace(',', '.')) === weight));
    }
  }

  function updateWeightLabel() {
    $('#weight-val').textContent = String(weight).replace('.', ',') + ' ct';
  }

  /* ---------- Запуск ---------- */
  function init(json) {
    data = json;
    $('#disclaimer').textContent = json.note;

    $('#weight').addEventListener('input', function (e) {
      weight = parseFloat(e.target.value);
      updateWeightLabel();
      markTicks();
      render();
    });

    $('#r-discuss').href = TG;
    $('#r-copy').addEventListener('click', copyLink);

    // Если в адресе лежит сохранённый выбор — открываемся на нём.
    // Кнопки изделий рисуем сами: setProduct сбросил бы исполнение
    // на первое в списке и восстановление потеряло бы смысл.
    if (restoreFromUrl()) {
      afterVariant();
      chips($('#f-product'), data.products, product.id, setProduct);
      renderVariants();
    } else {
      setProduct(json.products[0]);
    }
    $('#calc').hidden = false;
    $('#loading').hidden = true;
  }

  fetch('../assets/data/pricing.json')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(function () {
      $('#loading').textContent = 'Не удалось загрузить расчёт. Напишите — посчитаю лично.';
    });
})();
