/* ============================================================
   sidebar.js —— 侧边栏导航
   ============================================================ */
(function() {
  'use strict';

  const sidebar = document.getElementById('sidebar');
  const toggleBtn = document.getElementById('toggleSidebarBtn');
  const closeBtn = document.getElementById('closeSidebarBtn');
  if (!sidebar) return;

  function openSidebar() { sidebar.classList.add('open'); }
  function closeSidebar() { sidebar.classList.remove('open'); }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (sidebar.classList.contains('open')) closeSidebar();
      else openSidebar();
    });
  }
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

  document.addEventListener('click', function(e) {
    if (sidebar.classList.contains('open')
        && !sidebar.contains(e.target)
        && e.target !== toggleBtn) {
      closeSidebar();
    }
  });

  // ESC 关闭
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
  });

  console.log('[侧边栏] 已加载');
})();