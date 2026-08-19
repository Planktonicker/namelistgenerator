/* A walk-through for the first time somebody opens a page.
 *
 * Both pages are handed to people who did not ask for them — a teacher who
 * wants a class list, an admin inheriting the job from whoever had it last.
 * Neither will read a README. So each page introduces itself once, pointing at
 * the things on screen, and then never again.
 *
 *   Tour.startOnce(key, steps)   run it if this browser has not seen it here
 *   Tour.start(steps)            run it now, whatever has been seen
 *   Tour.seen(key)               has it run here before
 *
 * A step is { el, title, body, before }. `el` is a selector; a step whose
 * element is missing or hidden still shows, centred and without a highlight,
 * so a tour is never broken by a control that is not on screen. `before` may
 * return a promise — the admin tour uses it to change tab.
 *
 * The key is scoped to the folder the page was opened from, so a second copy
 * of the app in another folder introduces itself again rather than assuming
 * the person in front of it is the same one.
 */
window.Tour = (function () {
  'use strict';

  var PREFIX = 'namelist.tour.';
  var ui = null;              // built on first use, then reused
  var steps = [];
  var at = 0;
  var done = null;            // called when the tour ends, however it ends

  function folderKey(key) {
    var here = String(location.href).replace(/[?#].*$/, '').replace(/[^/]*$/, '');
    return PREFIX + key + '@' + here;
  }

  function seen(key) {
    try { return localStorage.getItem(folderKey(key)) === 'done'; } catch (e) { return false; }
  }

  function markSeen(key) {
    try { localStorage.setItem(folderKey(key), 'done'); } catch (e) { /* private mode */ }
  }

  function build() {
    if (ui) return;
    var root = document.createElement('div');
    root.className = 'tour no-print';
    root.hidden = true;
    root.innerHTML =
      '<div class="tour-dim"></div>' +
      '<div class="tour-ring" hidden></div>' +
      '<div class="tour-bubble" role="dialog" aria-modal="true" aria-labelledby="tourTitle">' +
        '<h2 id="tourTitle"></h2>' +
        '<div class="tour-body"></div>' +
        '<div class="tour-foot">' +
          '<span class="tour-count muted small"></span>' +
          '<span class="spacer"></span>' +
          '<button type="button" class="linklike tour-skip">Skip</button>' +
          '<button type="button" class="tour-back">Back</button>' +
          '<button type="button" class="primary tour-next">Next</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    ui = {
      root: root,
      dim: root.querySelector('.tour-dim'),
      ring: root.querySelector('.tour-ring'),
      bubble: root.querySelector('.tour-bubble'),
      title: root.querySelector('#tourTitle'),
      body: root.querySelector('.tour-body'),
      count: root.querySelector('.tour-count'),
      back: root.querySelector('.tour-back'),
      next: root.querySelector('.tour-next'),
      skip: root.querySelector('.tour-skip'),
    };
    ui.next.addEventListener('click', function () { go(at + 1); });
    ui.back.addEventListener('click', function () { go(at - 1); });
    ui.skip.addEventListener('click', finish);
    ui.dim.addEventListener('click', finish);
    window.addEventListener('resize', place);
    window.addEventListener('keydown', function (ev) {
      if (ui.root.hidden) return;
      if (ev.key === 'Escape') { ev.preventDefault(); finish(); }
      else if (ev.key === 'ArrowRight' || ev.key === 'Enter') { ev.preventDefault(); go(at + 1); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(at - 1); }
    });
  }

  function target() {
    var sel = steps[at] && steps[at].el;
    if (!sel) return null;
    var node = document.querySelector(sel);
    if (!node) return null;
    var box = node.getBoundingClientRect();
    // A control that is hidden, collapsed or scrolled out of existence gets no
    // highlight; the step still reads, centred.
    return (box.width && box.height) ? node : null;
  }

  /* The highlight is one element with an enormous shadow spread: the ring sits
   * over the control and the shadow dims everything else, so there is no mask
   * to keep in step with it. */
  function place() {
    if (!ui || ui.root.hidden) return;
    var node = target();
    var pad = 6;
    ui.root.classList.toggle('plain', !node);
    ui.ring.hidden = !node;
    if (node) {
      var b = node.getBoundingClientRect();
      ui.ring.style.left = (b.left - pad) + 'px';
      ui.ring.style.top = (b.top - pad) + 'px';
      ui.ring.style.width = (b.width + pad * 2) + 'px';
      ui.ring.style.height = (b.height + pad * 2) + 'px';
    }
    var bw = ui.bubble.offsetWidth;
    var bh = ui.bubble.offsetHeight;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    if (!node) {
      ui.bubble.style.left = Math.round((vw - bw) / 2) + 'px';
      ui.bubble.style.top = Math.round((vh - bh) / 2) + 'px';
      return;
    }
    var r = node.getBoundingClientRect();
    // Below the control if it fits, above if it does not.
    var top = r.bottom + pad + 10;
    if (top + bh > vh - 8) top = Math.max(8, r.top - pad - 10 - bh);
    var left = r.left + r.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, vw - bw - 8));
    ui.bubble.style.left = Math.round(left) + 'px';
    ui.bubble.style.top = Math.round(top) + 'px';
  }

  function go(next) {
    if (next < 0) return;
    if (next >= steps.length) { finish(); return; }
    at = next;
    var step = steps[at];
    ui.title.textContent = step.title || '';
    // Bodies are written here, not by anyone using the app, so they may carry
    // a little markup.
    ui.body.innerHTML = step.body || '';
    ui.count.textContent = (at + 1) + ' of ' + steps.length;
    ui.back.disabled = at === 0;
    ui.next.textContent = at === steps.length - 1 ? 'Done' : 'Next';
    Promise.resolve(step.before ? step.before() : null).catch(function () { /* keep going */ })
      .then(function () {
        var node = target();
        if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', inline: 'nearest' });
        requestAnimationFrame(function () { place(); ui.next.focus(); });
      });
  }

  function finish() {
    if (!ui || ui.root.hidden) return;
    ui.root.hidden = true;
    var fn = done;
    done = null;
    if (fn) fn();
  }

  function start(list, onDone) {
    if (!list || !list.length) return;
    build();
    steps = list;
    done = onDone || null;
    ui.root.hidden = false;
    go(0);
  }

  /* A walk-through is for a person, and it covers the page until it is
   * dismissed. Under automation that would block every test that opens the
   * page, so it holds off — unless ?tour=on says otherwise, which is how the
   * walk-through's own tests drive it. */
  function automated() {
    try {
      return !!navigator.webdriver && !/[?&]tour=on(&|$)/.test(location.search);
    } catch (e) { return false; }
  }

  /* Run it the first time only. Marked as seen when it starts rather than when
   * it finishes: somebody who shuts it after one step has decided, and being
   * shown it again on the next open would be nagging. */
  function startOnce(key, list) {
    if (automated()) return false;
    // An empty list must not count as having been shown, or a wiring mistake
    // silently retires the tour for good.
    if (!list || !list.length) return false;
    if (seen(key)) return false;
    markSeen(key);
    start(list);
    return true;
  }

  return { start: start, startOnce: startOnce, seen: seen, markSeen: markSeen };
})();
