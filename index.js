// --- 省略前半部的圖片快取攔截 ---

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
                
                // 修復點：相容 ST 1.17.0 的變數名稱
                const currentChatId = isGroup 
                    ? (payload.id || payload.chat_file || payload.file_name) 
                    : ((payload.avatar_url || payload.character_name || payload.ch_name) + '|' + (payload.chat_file || payload.file_name));

                // 換聊天室時清空紀錄
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
                            console.warn('[Incremental Save] 後端拒絕了增量儲存，回退至常規儲存。');
                        }
                    } else {
                        console.log('[Incremental Save] 檢測到歷史訊息變更，執行標準全量儲存。');
                    }
                }

                // 常規全量儲存
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
