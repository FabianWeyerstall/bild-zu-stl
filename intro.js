// Intro-Fenster: erscheint beim ersten Besuch, danach über „Anleitung“ oben rechts.
(function () {
  const STORE = 'bild-zu-stl:intro-gesehen';
  const dlg = document.getElementById('intro');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  const close = () => {
    dlg.close();
    try { localStorage.setItem(STORE, '1'); } catch (e) { /* egal */ }
  };
  document.getElementById('helpBtn').addEventListener('click', () => dlg.showModal());
  document.getElementById('introClose').addEventListener('click', close);
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  dlg.addEventListener('cancel', () => { try { localStorage.setItem(STORE, '1'); } catch (e) { /* egal */ } });
  // Klick auf den abgedunkelten Hintergrund schließt ebenfalls
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  let seen = false;
  try { seen = localStorage.getItem(STORE) === '1'; } catch (e) { /* egal */ }
  if (!seen) dlg.showModal();
})();
