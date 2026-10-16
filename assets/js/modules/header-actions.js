/* ============================================================
   header-actions.js —— 非主站页面的「登录」「干员数据设置」按钮
   轻量实现：显示登录态 + 跳转主站处理
   ============================================================ */
(function () {
    'use strict';

    function getAccountInfo() {
        try {
            const token = localStorage.getItem('dijiang_account_token');
            const nickname = localStorage.getItem('dijiang_account_nickname');
            const email = localStorage.getItem('dijiang_account_email');
            if (token) {
                return { logged: true, label: nickname || email || '已登录' };
            }
        } catch (e) {}
        return { logged: false, label: '登录' };
    }

    function updateAccountBtn() {
        const label = document.getElementById('accountLabel');
        if (!label) return;
        const info = getAccountInfo();
        label.textContent = info.label;
        const btn = document.getElementById('accountBtn');
        if (btn) btn.title = info.logged ? '点击查看账号管理' : '点击登录';
    }

    function init() {
        const accountBtn = document.getElementById('accountBtn');
        const dataBtn = document.getElementById('dataSettingsBtn');

        if (accountBtn) {
            accountBtn.addEventListener('click', function () {
                // 跳转主站，由主站打开账号弹窗或账号管理弹窗
                window.location.href = '/?openAccount=1';
            });
        }

        if (dataBtn) {
            dataBtn.addEventListener('click', function () {
                if (confirm('干员数据设置仅在自动排班页可用。\n\n是否前往自动排班页进行导入或配置？')) {
                    window.location.href = '/?openDataSettings=1';
                }
            });
        }

        updateAccountBtn();

        // 跨标签页同步登录态
        window.addEventListener('storage', function (e) {
            if (e.key === 'dijiang_account_token' ||
                e.key === 'dijiang_account_nickname' ||
                e.key === 'dijiang_account_email') {
                updateAccountBtn();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();