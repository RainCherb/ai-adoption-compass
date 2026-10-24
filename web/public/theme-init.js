(function () {
  try {
    var stored = localStorage.getItem("compass-theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
    }
  } catch (_) {
    /* хранилище недоступно — остаётся системная тема */
  }
})();
