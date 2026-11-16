/* The embedded tool uses the host app's navigation; standalone pages keep a return path. */
(function () {
  const navigation = document.getElementById('workspace-navigation');
  if (navigation && new URLSearchParams(window.location.search).get('embedded') === '1') {
    navigation.hidden = true;
  }
})();
