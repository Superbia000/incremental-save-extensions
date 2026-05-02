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

// --- 2. 攔截 Fetch 實現增量儲存 ---
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
                const currentChatId = isGroup ? (payload.id || payload.chat_file) : (payload.avatar_url + '|' + payload.chat_file);

                // 換聊天室時清空紀錄
                if (lastChatId !== currentChatId) {
                    lastSavedLog = null;
                    lastChatId = currentChatId;
                }

                // 驗證是否只新增了新訊息
                if (lastSavedLog && currentLog && currentLog.length > lastSavedLog.length) {
                    const expectedLines = lastSavedLog.length;
                    let isAppend = true;

                    // 檢查先前的訊息是否有被編輯、刪除或 swipe
                    for (let i = 0; i < expectedLines; i++) {
                        if (JSON.stringify(currentLog[i]) !== JSON.stringify(lastSavedLog[i])) {
                            isAppend = false;
                            break;
                        }
                    }

                    // 條件吻合，觸發增量覆寫
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
                            console.log(`[Incremental Save] 成功追加 ${newMessages.length} 條訊息`);
                            lastSavedLog = JSON.parse(JSON.stringify(currentLog));
                            return response; // 攔截成功，直接返回略過全量覆寫
                        } else {
                            console.warn('[Incremental Save] 追加失敗，回退至全量儲存。');
                        }
                    }
                }

                // 未觸發追加條件（例如編輯訊息、剛開啟 ST），則執行常規的全量儲存
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
    // 非對目標網址發出的 Fetch 皆放行
    return originalFetch.apply(this, arguments);
};
