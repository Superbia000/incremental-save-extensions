// --- 啟動時的 UI 提示 ---
setTimeout(() => {
    if (window.toastr) {
        window.toastr.success('🚀 增量儲存與快取擴充已成功載入並監聽中！', 'Incremental Save', { timeOut: 3000 });
    }
    console.log('[Incremental Save] 前端擴充已啟動');
}, 2000); // 延遲 2 秒等待 ST 介面載入完畢

// --- 1. 攔截圖片讀取並進行代理 ---
function hookDOMPurify() {
    if (window.DOMPurify && window.DOMPurify.addHook) {
        window.DOMPurify.addHook('afterSanitizeAttributes', function (node) {
            if (node.tagName === 'IMG' && node.src) {
                const src = node.getAttribute('src');
                if (src && src.startsWith('http') && !src.includes('/api/plugins/incremental-save') && !src.startsWith(window.location.origin)) {
                    node.setAttribute('src', `/api/plugins/incremental-save/image-proxy?url=${encodeURIComponent(src)}`);
                }
            }
        });
    } else {
        setTimeout(hookDOMPurify, 500);
    }
}
hookDOMPurify();

const originalImageSrc = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
if (originalImageSrc) {
    Object.defineProperty(Image.prototype, 'src', {
        set(val) {
            if (val && typeof val === 'string' && val.startsWith('http') && !val.includes('/api/plugins/incremental-save') && !val.startsWith(window.location.origin)) {
                val = `/api/plugins/incremental-save/image-proxy?url=${encodeURIComponent(val)}`;
            }
            originalImageSrc.set.call(this, val);
        },
        get() { return originalImageSrc.get.call(this); }
    });
}

// ... 前半部圖片攔截保留 ...

let lastSavedLog = null;
let lastChatId = null;
const originalFetch = window.fetch;

window.fetch = async function (url, options) {
    if (typeof url === 'string' && (url.includes('/api/chats/save') || url.includes('/api/chats/group/save'))) {
        try {
            if (options && options.body) {
                const payload = JSON.parse(options.body);
                const currentLog = payload.log || payload.chat;
                const isGroup = url.includes('/group/save');
                
                const currentChatId = isGroup 
                    ? (payload.id || payload.chat_file || payload.file_name) 
                    : ((payload.character_name || payload.ch_name || payload.avatar_url) + '|' + (payload.chat_file || payload.file_name));

                if (lastChatId !== currentChatId) {
                    lastSavedLog = null;
                    lastChatId = currentChatId;
                }

                if (lastSavedLog && currentLog && currentLog.length > lastSavedLog.length) {
                    const expectedLines = lastSavedLog.length;
                    let isAppend = true;

                    for (let i = 0; i < expectedLines; i++) {
                        if (JSON.stringify(currentLog[i]) !== JSON.stringify(lastSavedLog[i])) {
                            isAppend = false;
                            break;
                        }
                    }

                    if (isAppend) {
                        const newMessages = currentLog.slice(expectedLines);
                        const pluginUrl = isGroup 
                            ? '/api/plugins/incremental-save/group/save-append' 
                            : '/api/plugins/incremental-save/save-append';
                        
                        const newOptions = {
                            ...options,
                            body: JSON.stringify({
                                ...payload,
                                log: undefined,
                                chat: undefined,
                                newMessages: newMessages,
                                expectedLines: expectedLines
                            })
                        };

                        const response = await originalFetch(pluginUrl, newOptions);
                        if (response.ok) {
                            if (window.toastr) {
                                window.toastr.info(`⚡ 觸發極速增量儲存 (+${newMessages.length} 條)`, 'Incremental Save', { timeOut: 2000 });
                            }
                            lastSavedLog = JSON.parse(JSON.stringify(currentLog));
                            return response;
                        } else {
                            // 增強除錯：取得後端詳細錯誤原因並印出
                            const errText = await response.text();
                            console.warn(`[Incremental Save] 後端拒絕了增量儲存 (狀態碼: ${response.status})，原因:`, errText, '-> 回退至常規儲存。');
                        }
                    } else {
                        console.log('[Incremental Save] 檢測到歷史訊息變更，執行標準全量儲存。');
                    }
                }

                const response = await originalFetch(url, options);
                if (response.ok && currentLog) {
                    lastSavedLog = JSON.parse(JSON.stringify(currentLog));
                }
                return response;
            }
        } catch (e) {
            console.error('[Incremental Save] 攔截器錯誤:', e);
        }
    }
    return originalFetch.apply(this, arguments);
};
