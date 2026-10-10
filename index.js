Const express = require('express');
const app = express();

const BOT_TOKEN = '8655058369:AAGo-4rFve2eK21RbVk6CXc6e2_wwbrLCCQ';
const ADMIN_ID = '7482625921';

app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
});

let users = {};
let pendingRequests = {};

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    try {
        let body = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
        if (replyMarkup) body.reply_markup = replyMarkup;
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (e) {
        console.log("Telegram API Error:", e);
    }
}

async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
    try {
        let body = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown' };
        if (replyMarkup) body.reply_markup = replyMarkup;
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (e) {
        console.log("Telegram Edit Error:", e);
    }
}

async function answerCallbackQuery(callbackQueryId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text: text })
        });
    } catch (e) {
        console.log("Callback Answer Error:", e);
    }
}

// Telegram Webhook
app.post(`/api/webhook/${BOT_TOKEN}`, async (req, res) => {
    const update = req.body;
    res.sendStatus(200);

    try {
        if (update.message) {
            const msg = update.message;
            const chatId = String(msg.chat.id);
            const text = msg.text || '';

            if (text.startsWith('/start')) {
                const parts = text.split(' ');
                const referrerId = parts[1] ? String(parts[1]) : null;

                if (!users[chatId]) {
                    users[chatId] = {
                        id: chatId,
                        username: msg.from.username || msg.from.first_name || 'User',
                        balance: 0,
                        ghs: 0,
                        lastClaimTime: Date.now(),
                        deposits: [],
                        withdrawals: [],
                        referredBy: referrerId || null,
                        referrals: { level1: [], level2: [], level3: [] },
                        refEarnings: { level1: 0, level2: 0, level3: 0 }
                    };

                    if (referrerId && users[referrerId] && referrerId !== chatId) {
                        users[chatId].referredBy = referrerId;
                        if (!users[referrerId].referrals.level1.includes(chatId)) {
                            users[referrerId].referrals.level1.push(chatId);
                            sendTelegramMessage(referrerId, `🎉 New Level 1 Referral Joined! ID: ${chatId}`);
                        }

                        const level2Ref = users[referrerId].referredBy;
                        if (level2Ref && users[level2Ref]) {
                            if (!users[level2Ref].referrals.level2.includes(chatId)) {
                                users[level2Ref].referrals.level2.push(chatId);
                            }

                            const level3Ref = users[level2Ref].referredBy;
                            if (level3Ref && users[level3Ref]) {
                                if (!users[level3Ref].referrals.level3.includes(chatId)) {
                                    users[level3Ref].referrals.level3.push(chatId);
                                }
                            }
                        }
                    }
                }

                // English Welcome Message with Inline Keyboard Button
                const replyMarkup = {
                    inline_keyboard: [
                        [
                            {
                                text: "⛏️ Open Mining App",
                                web_app: { url: "Aapke_Mini_App_Ka_URL_Yahan_Aayega" } // Yahan apna web app URL daal dein
                            }
                        ]
                    ]
                };

                await sendTelegramMessage(
                    chatId, 
                    "🚀 **Welcome to BitHarvest USDT Mining Mini App!**\n\nClick the **Open Mining App** button below to launch the app.", 
                    replyMarkup
                );
            }
        } else if (update.callback_query) {
            const query = update.callback_query;
            const chatId = String(query.message.chat.id);
            const data = query.data;
            const messageId = query.message.message_id;

            if (data.startsWith('approve_') || data.startsWith('reject_')) {
                if (chatId !== String(ADMIN_ID)) {
                    return answerCallbackQuery(query.id, "Unauthorized!");
                }

                const isApprove = data.startsWith('approve_');
                const reqKey = data.replace(isApprove ? 'approve_' : 'reject_', '');
                const req = pendingRequests[reqKey];

                if (!req) {
                    return answerCallbackQuery(query.id, "Request already handled or expired!");
                }

                const u = users[req.userId];

                if (isApprove) {
                    if (req.type === 'deposit') {
                        if (u) {
                            const depAmount = parseFloat(req.amount);
                            u.ghs += depAmount;
                            const dep = u.deposits.find(d => d.id === req.reqId);
                            if (dep) dep.status = 'PAID';

                            // Referral Commission
                            let currentU = u;
                            if (currentU.referredBy && users[currentU.referredBy]) {
                                let l1User = users[currentU.referredBy];
                                let comm1 = depAmount * 0.15;
                                l1User.balance += comm1;
                                l1User.refEarnings.level1 += comm1;
                                sendTelegramMessage(l1User.id, `🎁 Level 1 Commission Received: +${comm1.toFixed(4)} USDT!`);

                                if (l1User.referredBy && users[l1User.referredBy]) {
                                    let l2User = users[l1User.referredBy];
                                    let comm2 = depAmount * 0.02;
                                    l2User.balance += comm2;
                                    l2User.refEarnings.level2 += comm2;
                                    sendTelegramMessage(l2User.id, `🎁 Level 2 Commission Received: +${comm2.toFixed(4)} USDT!`);

                                    if (l2User.referredBy && users[l2User.referredBy]) {
                                        let l3User = users[l2User.referredBy];
                                        let comm3 = depAmount * 0.01;
                                        l3User.balance += comm3;
                                        l3User.refEarnings.level3 += comm3;
                                        sendTelegramMessage(l3User.id, `🎁 Level 3 Commission Received: +${comm3.toFixed(4)} USDT!`);
                                    }
                                }
                            }
                        }
                        sendTelegramMessage(req.userId, `✅ Your deposit of ${req.amount} USDT has been approved! ${req.amount} GHS Power added.`);
                    }
                }
            }
        }
    } catch (err) {
        console.log("Webhook Error:", err);
    }
});
