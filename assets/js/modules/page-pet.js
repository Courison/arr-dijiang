/* ============================================================
   page-pet.js —— 非主站页面的桌宠配套
   1. 注入独立反馈弹窗（复用主站结构）
   2. 实现 window.DijiangOpenFeedback
   3. 实现 window.DijiangExportSchedule 存根（气泡提示跳转）
   不依赖 main.js
   ============================================================ */
(function () {
    'use strict';

    // ---------- 注入反馈弹窗 HTML ----------
    function injectFeedbackModal() {
        if (document.getElementById('feedbackModal')) return;
        const wrap = document.createElement('div');
        wrap.innerHTML =
            '<div class="modal-overlay" id="feedbackModal">' +
                '<div class="batch-modal" style="max-width:700px;">' +
                    '<div class="batch-header">' +
                        '<h2>反馈 &amp; 建议</h2>' +
                        '<button class="close-btn" id="feedbackCloseBtn">✕</button>' +
                    '</div>' +
                    '<div style="flex:1; overflow-y:auto;">' +
                        '<div style="margin-bottom:16px;">' +
                            '<label style="font-weight:600; display:block; margin-bottom:6px;">1. 使用时遇到的问题或对本工具的建议</label>' +
                            '<textarea id="feedbackText" class="feedback-textarea" placeholder="请详细描述您的反馈..."></textarea>' +
                        '</div>' +
                        '<div>' +
                            '<label style="font-weight:600; display:block; margin-bottom:6px;">2. 截图上传（总图片大小不超过5M）</label>' +
                            '<div class="feedback-file-area" id="feedbackFileArea">' +
                                '<span style="color:#888;">点击或拖拽上传图片（支持 jpg/png/webp）</span>' +
                                '<input type="file" id="feedbackFileInput" accept="image/*" multiple style="display:none;">' +
                            '</div>' +
                            '<div class="feedback-file-list" id="feedbackFileList"></div>' +
                            '<div style="font-size:0.8rem; color:#888; margin-top:6px;">已选文件总大小：<span id="feedbackTotalSize">0</span> KB（上限 5120 KB）</div>' +
                        '</div>' +
                        '<div id="feedbackStatus" class="feedback-status"></div>' +
                    '</div>' +
                    '<div class="save-area" style="justify-content:flex-end; margin-top:16px;">' +
                        '<button class="btn-cancel" id="feedbackCancelBtn">取消</button>' +
                        '<button class="btn-save" id="feedbackSubmitBtn">确认提交</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(wrap.firstChild);
    }

    // ---------- 绑定反馈逻辑 ----------
    function initFeedback() {
        const modal = document.getElementById('feedbackModal');
        if (!modal) return;

        const closeBtn = document.getElementById('feedbackCloseBtn');
        const cancelBtn = document.getElementById('feedbackCancelBtn');
        const submitBtn = document.getElementById('feedbackSubmitBtn');
        const textarea = document.getElementById('feedbackText');
        const fileInput = document.getElementById('feedbackFileInput');
        const fileArea = document.getElementById('feedbackFileArea');
        const fileList = document.getElementById('feedbackFileList');
        const totalSizeSpan = document.getElementById('feedbackTotalSize');
        const statusDiv = document.getElementById('feedbackStatus');

        let selectedFiles = [];
        let totalSize = 0;

        function openFeedback() {
            modal.classList.add('open');
            textarea.value = '';
            selectedFiles = [];
            totalSize = 0;
            updateFileList();
            updateTotalSize();
            statusDiv.className = 'feedback-status';
            statusDiv.style.display = 'none';
        }
        function closeFeedback() { modal.classList.remove('open'); }

        function updateFileList() {
            fileList.innerHTML = '';
            selectedFiles.forEach(function (file, index) {
                const item = document.createElement('div');
                item.className = 'feedback-file-item';
                item.innerHTML =
                    '<span>' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)</span>' +
                    '<span class="remove-file" data-index="' + index + '">×</span>';
                fileList.appendChild(item);
            });
            fileList.querySelectorAll('.remove-file').forEach(function (el) {
                el.addEventListener('click', function () {
                    const idx = parseInt(this.dataset.index, 10);
                    totalSize -= selectedFiles[idx].size;
                    selectedFiles.splice(idx, 1);
                    updateFileList();
                    updateTotalSize();
                });
            });
        }
        function updateTotalSize() {
            totalSizeSpan.textContent = (totalSize / 1024).toFixed(1);
        }
        function addFiles(newFiles) {
            for (const f of newFiles) {
                if (!f.type.startsWith('image/')) { showStatus('仅支持图片文件', 'error'); continue; }
                if (totalSize + f.size > 5 * 1024 * 1024) { showStatus('超过5M上限', 'error'); continue; }
                selectedFiles.push(f);
                totalSize += f.size;
            }
            updateFileList();
            updateTotalSize();
        }
        function showStatus(msg, type) {
            statusDiv.textContent = msg;
            statusDiv.className = 'feedback-status ' + type;
            statusDiv.style.display = 'block';
        }

        window.DijiangOpenFeedback = openFeedback;

        if (closeBtn) closeBtn.addEventListener('click', closeFeedback);
        if (cancelBtn) cancelBtn.addEventListener('click', closeFeedback);
        modal.addEventListener('click', function (e) { if (e.target === modal) closeFeedback(); });

        if (fileArea) {
            fileArea.addEventListener('click', function () { fileInput.click(); });
            fileArea.addEventListener('dragover', function (e) { e.preventDefault(); fileArea.style.borderColor = '#3f7e6b'; });
            fileArea.addEventListener('dragleave', function (e) { e.preventDefault(); fileArea.style.borderColor = '#d0d7de'; });
            fileArea.addEventListener('drop', function (e) {
                e.preventDefault();
                fileArea.style.borderColor = '#d0d7de';
                addFiles(e.dataTransfer.files);
            });
        }
        if (fileInput) {
            fileInput.addEventListener('change', function () {
                if (this.files.length) { addFiles(this.files); this.value = ''; }
            });
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', function () {
                const text = textarea.value.trim();
                if (!text) { showStatus('请输入反馈内容', 'error'); return; }
                const formData = new FormData();
                formData.append('text', text);
                selectedFiles.forEach(function (file, idx) {
                    formData.append('images[]', file, (idx + 1) + '.' + file.name.split('.').pop());
                });
                submitBtn.disabled = true;
                submitBtn.textContent = '提交中...';
                fetch('/submit_feedback.php', { method: 'POST', body: formData })
                    .then(function (res) { return res.json(); })
                    .then(function (data) {
                        if (data.success) {
                            showStatus('✅ 反馈提交成功！', 'success');
                            if (typeof window.DijiangPetSay === 'function') {
                                window.DijiangPetSay('管理员，感谢你的反馈~');
                            }
                            setTimeout(function () {
                                closeFeedback();
                                submitBtn.disabled = false;
                                submitBtn.textContent = '确认提交';
                            }, 2000);
                        } else {
                            showStatus('❌ 失败：' + (data.message || '未知错误'), 'error');
                            submitBtn.disabled = false;
                            submitBtn.textContent = '确认提交';
                        }
                    })
                    .catch(function () {
                        showStatus('❌ 网络错误', 'error');
                        submitBtn.disabled = false;
                        submitBtn.textContent = '确认提交';
                    });
            });
        }
    }

    // ---------- 导出排班存根：气泡提示跳转 ----------
    function installExportStub() {
        // ★ 如果页面已经定义了导出函数（比如手动排班页的 manual.js 已经加载），则不覆盖
        if (typeof window.DijiangExportSchedule === 'function') {
            return;
        }

        window.DijiangExportSchedule = function () {
            const msg = '管理员，导出排班图请在「自动排班」或「手动排班」页使用哦~';
            if (typeof window.DijiangPetSay === 'function') {
                window.DijiangPetSay(msg, true);
            } else {
                alert(msg);
            }
        };
    }

    // ---------- 启动 ----------
    function init() {
        injectFeedbackModal();
        initFeedback();
        installExportStub();
        console.log('[page-pet] 已就绪：反馈可用，导出排班转为气泡提示');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();