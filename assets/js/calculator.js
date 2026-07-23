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

  // Границы бюджетных корзин каталога, чтобы перебросить туда с фильтром
  var BUDGETS = [
    [0, 5000, 'до 5 000'],
    [5000, 10000, '5 000–10 000'],
    [10000, 30000, '10 000–30 000'],
    [30000, Infinity, 'от 30 000'],
  ];

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
      $('#r-mm').textContent = d.toFixed(1).replace('.', ',') + ' мм';
      $('#r-mm-row').hidden = false;
      // 1 мм ≈ 3.8 px: камень на экране примерно в натуральную величину
      var px = Math.max(10, Math.round(d * 3.8));
      $('#size-stone').style.width = px + 'px';
      $('#size-stone').style.height = px + 'px';
      $('#size-cap').textContent = 'Примерно так камень выглядит вживую: ' +
        d.toFixed(1).replace('.', ',') + ' мм в диаметре' +
        (product.id === 'studs' ? ' (каждый в паре)' : '');
      vis.hidden = false;
    } else {
      $('#r-mm-row').hidden = true;
      vis.hidden = true;
    }

    if (!span) {
      out.classList.add('is-out');
      $('#r-price').textContent = 'Рассчитаем индивидуально';
      $('#r-price-note').textContent =
        'Такой вес выходит за таблицы каталога — цену подберу под конкретный камень.';
      $('#r-to-catalog').hidden = true;
      return;
    }

    out.classList.remove('is-out');
    var lo = toHundreds(span[0]), hi = toHundreds(span[1]);
    $('#r-price').textContent = lo === hi ? money(lo) : money(lo) + ' — ' + money(hi);
    $('#r-price-note').textContent = lo === hi
      ? 'Ориентировочно, за изделие целиком'
      : 'Ориентировочная вилка за изделие целиком';

    var mid = (lo + hi) / 2;
    var band = BUDGETS.find(function (b) { return mid >= b[0] && mid < b[1]; });
    var link = $('#r-to-catalog');
    link.hidden = false;
    link.href = '../catalog/?budget=' + encodeURIComponent(band[2]) + '&stock=1';
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

  function renderVariants() {
    chips($('#f-variant'),
      product.variants.map(function (v) { return { id: v.id, name: v.name }; }),
      variant.id,
      function (it) {
        variant = product.variants.filter(function (v) { return v.id === it.id; })[0];
        afterVariant();
        renderVariants();
      });
  }

  function afterVariant() {
    // Качество: «любое» даёт честную вилку по данным, а не выдуманный разброс
    var opts = [{ id: 'any', name: 'Любое' }].concat(
      variant.grades.map(function (g) { return { id: g, name: g }; }));
    if (variant.grades.length < 2) { grade = variant.grades[0]; }
    else if (!opts.some(function (o) { return o.id === grade; })) { grade = 'any'; }

    var host = $('#f-grade');
    $('#grade-field').hidden = variant.grades.length < 2;
    if (variant.grades.length >= 2) {
      chips(host, opts, grade, function (it) { grade = it.id; afterVariant(); render(); });
    }

    var ws = variant.rows.map(function (r) { return r[0]; });
    var min = Math.min.apply(null, ws), max = Math.max.apply(null, ws);
    var slider = $('#weight');
    slider.min = min; slider.max = max;
    slider.step = max - min > 6 ? 0.1 : 0.05;
    if (weight === undefined || weight < min || weight > max) weight = ws[Math.floor(ws.length / 2)];
    slider.value = weight;
    $('#weight-label').textContent = (product.weight_label || variant.weight_label || 'Вес камня');
    $('#w-min').textContent = min + ' ct';
    $('#w-max').textContent = max + ' ct';
    updateWeightLabel();

    var img = $('#cut-img');
    img.src = '../assets/img/cuts/' + variant.cut + '.webp';
    img.alt = 'Пример изделия: огранка ' + variant.cut;
    var dia = $('#cut-diagram');
    dia.src = '../assets/img/cuts/' + variant.cut + '-diagram.webp';
    dia.alt = '';
    render();
  }

  function updateWeightLabel() {
    $('#weight-val').textContent = String(weight).replace('.', ',') + ' ct';
  }

  /* ---------- Запуск ---------- */
  function init(json) {
    data = json;
    $('#disclaimer').textContent = json.note;

    var terms = $('#terms-grid');
    json.terms.forEach(function (t) {
      var d = document.createElement('div');
      var h = document.createElement('h3'); h.textContent = t[0];
      var p = document.createElement('p'); p.textContent = t[1];
      d.appendChild(h); d.appendChild(p); terms.appendChild(d);
    });

    $('#weight').addEventListener('input', function (e) {
      weight = parseFloat(e.target.value);
      updateWeightLabel();
      render();
    });

    $('#r-discuss').href = TG;
    setProduct(json.products[0]);
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
