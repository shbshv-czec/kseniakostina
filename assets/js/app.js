/* ============================================================
   kseniakostina.ru — интерактив

   Правила, которых держится этот файл:
   • один слушатель прокрутки на всю страницу, вся работа — внутри
     requestAnimationFrame;
   • внутри кадра сначала все измерения, потом все записи — иначе
     браузер пересчитывает раскладку по нескольку раз за кадр;
   • при включённой в системе экономии движения анимации не запускаются.
   ============================================================ */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Появление блоков при прокрутке ---------- */
  function initReveal() {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;

    if (reduced) {
      els.forEach(function (el) { el.classList.add('is-revealed'); });
      return;
    }

    els.forEach(function (el) {
      el.style.transitionDelay = (el.getAttribute('data-reveal') || '0') + 'ms';
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-revealed');
        io.unobserve(e.target);
      });
    }, { threshold: 0.1 });

    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Счётчики в блоке «Цифры» ---------- */
  function initCounters() {
    var els = document.querySelectorAll('[data-count]');
    // Итоговые значения уже стоят в разметке, так что при экономии
    // движения делать нечего — цифры и так на месте.
    if (!els.length || reduced) return;

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);

        var el = e.target;
        var target = parseInt(el.getAttribute('data-count'), 10);
        var pre = el.getAttribute('data-prefix') || '';
        var suf = el.getAttribute('data-suffix') || '';
        var t0 = performance.now();
        var dur = 1800;

        (function step(t) {
          var k = Math.min(1, (t - t0) / dur);
          el.textContent = pre + Math.round(target * (1 - Math.pow(1 - k, 3))) + suf;
          if (k < 1) requestAnimationFrame(step);
        })(t0);
      });
    }, { threshold: 0.5 });

    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Гармошка FAQ ----------
     Атрибут open переключается по-настоящему, поэтому скринридер и
     поиск видят то же состояние, что и зрячий посетитель. Высота
     анимируется вручную, потому что <details> сам этого не умеет. */
  function initFaq() {
    document.querySelectorAll('#faq details').forEach(function (d) {
      var s = d.querySelector('summary');
      var p = d.querySelector('p');
      if (!s || !p) return;

      s.addEventListener('click', function (e) {
        e.preventDefault();

        if (reduced) { d.open = !d.open; return; }

        if (d.open) {
          set(p.scrollHeight + 'px', '1');
          reflow(p);
          set('0px', '0');
          afterTransition(p, function () { d.open = false; });
        } else {
          d.open = true;
          set('0px', '0');
          reflow(p);
          set(p.scrollHeight + 'px', '1');
          // Снимаем фиксированную высоту, иначе текст обрежется,
          // когда абзац переверстается на другой ширине окна.
          afterTransition(p, function () { p.style.maxHeight = 'none'; });
        }
      });

      function set(maxHeight, opacity) {
        p.style.maxHeight = maxHeight;
        p.style.opacity = opacity;
      }
    });

    // Принудительный пересчёт раскладки фиксирует стартовое состояние,
    // чтобы браузер увидел переход. Через requestAnimationFrame делать
    // это нельзя: в фоновой вкладке кадры не выдаются и анимация
    // не начинается вовсе.
    function reflow(el) { void el.offsetHeight; }

    // transitionend может не прийти — если переход не стартовал или его
    // прервали. Страховочный таймер гарантирует, что состояние доедет.
    function afterTransition(el, fn) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        el.removeEventListener('transitionend', onEnd);
        clearTimeout(timer);
        fn();
      }
      function onEnd(ev) { if (ev.propertyName === 'max-height') finish(); }
      el.addEventListener('transitionend', onEnd);
      var timer = setTimeout(finish, 700);   // длительность перехода 550ms
    }
  }

  /* ---------- Мобильное меню ---------- */
  function initMenu() {
    var burger = document.getElementById('burgerBtn');
    var menu = document.getElementById('mobileMenu');
    if (!burger || !menu) return;

    function set(open) {
      if (open) menu.setAttribute('data-open', '1');
      else menu.removeAttribute('data-open');
      burger.setAttribute('aria-expanded', String(open));
    }

    burger.addEventListener('click', function () {
      set(burger.getAttribute('aria-expanded') !== 'true');
    });
    menu.addEventListener('click', function () { set(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (burger.getAttribute('aria-expanded') !== 'true') return;
      set(false);
      burger.focus();
    });
  }

  /* ---------- Параллакс и залипающая «крошка» ----------
     Единственный слушатель прокрутки на странице. */
  function initScrollEffects() {
    var layers = [];
    document.querySelectorAll('[data-plx],[data-zoom]').forEach(function (el) {
      layers.push({
        el: el,
        shift: parseFloat(el.getAttribute('data-plx')) || 0,
        zoom: parseFloat(el.getAttribute('data-zoom')) || 0
      });
    });

    var crumb = document.getElementById('heroTweezers');
    var hero = document.getElementById('hero');
    var title = document.getElementById('aboutTitle');
    var pinnable = crumb && hero && title;

    if (!pinnable && (reduced || !layers.length)) return;

    var offsets = new Array(layers.length);
    var scheduled = false;

    function frame() {
      scheduled = false;
      var h = window.innerHeight;
      var i;

      /* — фаза измерений: только чтение раскладки — */
      if (!reduced) {
        for (i = 0; i < layers.length; i++) {
          var r = layers[i].el.getBoundingClientRect();
          offsets[i] = (r.bottom < -100 || r.top > h + 100)
            ? null
            : (r.top + r.height / 2 - h / 2) / h;
        }
      }

      var crumbTop = null;
      if (pinnable) {
        // Едет вверх вместе с первым экраном, залипает на 46% высоты
        // окна, снова уезжает, когда до неё доходит заголовок «Обо мне».
        var pin = Math.round(h * 0.46);
        var ride = hero.getBoundingClientRect().bottom - Math.round(crumb.offsetHeight * 0.42);
        crumbTop = ride > pin
          ? ride
          : Math.min(pin, title.getBoundingClientRect().bottom - crumb.offsetHeight);
      }

      /* — фаза записи: только изменение стилей — */
      if (!reduced) {
        for (i = 0; i < layers.length; i++) {
          var v = offsets[i];
          if (v === null) continue;
          var l = layers[i];
          if (l.shift) {
            l.el.style.setProperty('--plx-y', (v * l.shift * 100).toFixed(1) + 'px');
          }
          if (l.zoom) {
            var k = Math.max(0, Math.min(1, 0.5 - v));
            l.el.style.setProperty('--gem-scale', (1 + k * l.zoom).toFixed(3));
          }
        }
      }
      if (crumbTop !== null) crumb.style.top = crumbTop + 'px';
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(frame);
    }

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    if (crumb && !crumb.complete) crumb.addEventListener('load', schedule);

    // Стартовую позицию считаем сразу, а не через кадр: иначе «крошка»
    // успевает мелькнуть на своём месте по умолчанию, а в фоновой вкладке
    // requestAnimationFrame вообще не вызовется до её открытия.
    frame();
  }

  initReveal();
  initCounters();
  initFaq();
  initMenu();
  initScrollEffects();
})();
