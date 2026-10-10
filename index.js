const express = require('express');
const app = express();

const BOT_TOKEN = '8655058369:AAGo-4rFve2eK21RbVk6CXc6e2_wwbrLCCQ';
const ADMIN_ID = '7482625921';

app.use(express.json());

// Enable CORS manually
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
});

let users = {};
let pendingRequests = {};

// Helper to send Telegram messages
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

// Helper to edit Telegram messages
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

// Helper to answer callback queries
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

// Telegram Webhook Endpoint to handle /start and Button Clicks
app.post(`/api/webhook/${BOT_TOKEN}`, async (req, res) => {
    const update = req.body;
    res.sendStatus(200);

    try {
        if (update.message) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = msg.text || '';

            if (text.startsWith('/start')) {
                const parts = text.split(' ');
                const referrerId = parts[1];

                if (!users[chatId]) {
                    users[chatId] = {
                        id: chatId,
                        username: msg.from.username || msg.from.first_name || 'User',
                        balance: 0,
                        ghs: 0,
                        deposits: [],
                        withdrawals: [],
                        referredBy: referrerId || null,
                        referrals: { level1: [], level2: [], level3: [] }
                    };

                    if (referrerId && users[referrerId]) {
                        users[referrerId].referrals.level1.push(chatId);
                        sendTelegramMessage(referrerId, `🎉 New Referral Joined! User ID: ${chatId}`);
                    }
                }

                const keyboard = {
                    inline_keyboard: [
                        [{ text: "⛏️ Open Mining App", web_app: { url: "https://bitharvest.netlify.app" } }]
                    ]
                };
                await sendTelegramMessage(chatId, "🚀 Welcome to BitHarvest USDT Mining Mini App!", keyboard);
            }
        } else if (update.callback_query) {
            const query = update.callback_query;
            const chatId = query.message.chat.id;
            const data = query.data;
            const messageId = query.message.message_id;

            if (data.startsWith('approve_') || data.startsWith('reject_')) {
                if (String(chatId) !== String(ADMIN_ID)) {
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
                            u.ghs += parseFloat(req.amount);
                            const dep = u.deposits.find(d => d.id === req.reqId);
                            if (dep) dep.status = 'PAID';
                        }
                        sendTelegramMessage(req.userId, `✅ Your deposit of ${req.amount} USDT has been approved!${req.amount} GHS Power added to your account.`);
                    } else if (req.type === 'withdraw') {
                        if (u) {
                            u.balance -= parseFloat(req.amount);
                            const wd = u.withdrawals.find(w => w.id === req.reqId);
                            if (wd) wd.status = 'PAID';
                        }
                        sendTelegramMessage(req.userId, `✅ Your withdrawal of ${req.amount} USDT has been approved and sent to your wallet!`);
                    }
                    editTelegramMessage(chatId, messageId, `✅ **Request Approved**\nUser ID: ${req.userId}\nAmount:${req.amount} USDT`);
                } else {
                    if (req.type === 'deposit') {
                        if (u) {
                            const dep = u.deposits.find(d => d.id === req.reqId);
                            if (dep) dep.status = 'DECLINED';
                        }
                        sendTelegramMessage(req.userId, `❌ Your deposit request of ${req.amount} USDT was rejected by admin.`);
                    } else if (req.type === 'withdraw') {
                        if (u) {
                            const wd = u.withdrawals.find(w => w.id === req.reqId);
                            if (wd) wd.status = 'DECLINED';
                        }
                        sendTelegramMessage(req.userId, `❌ Your withdrawal request of ${req.amount} USDT was rejected by admin.`);
                    }
                    editTelegramMessage(chatId, messageId, `❌ **Request Rejected**\nUser ID: ${req.userId}\nAmount:${req.amount} USDT`);
                }

                delete pendingRequests[reqKey];
                answerCallbackQuery(query.id, "Done!");
            }
        }
    } catch (err) {
        console.log("Webhook error:", err);
    }
});

// API to get user data for Mini App
app.get('/api/user/:userId', (req, res) => {
    const userId = req.params.userId;
    if (!users[userId]) {
        users[userId] = {
            id: userId,
            username: 'User',
            balance: 0,
            ghs: 0,
            deposits: [],
            withdrawals: [],
            referredBy: null,
            referrals: { level1: [], level2: [], level3: [] }
        };
    }
    res.json(users[userId]);
});

// Deposit API from Mini App
app.post('/api/deposit', async (req, res) => {
    const { userId, username, amount, txHash } = req.body;
    if (!userId || !amount) return res.status(400).json({ success: false, message: "Missing data" });

    if (!users[userId]) {
        users[userId] = { id: userId, username: username || 'User', balance: 0, ghs: 0, deposits: [], withdrawals: [], referredBy: null, referrals: { level1: [], level2: [], level3: [] } };
    }

    const reqId = 'dep_' + Date.now();
    const depositItem = { id: reqId, amount: amount, txHash: txHash, status: 'PENDING', date: new Date().toLocaleDateString() };
    
    users[userId].deposits.unshift(depositItem);
    pendingRequests[reqId] = { type: 'deposit', userId: userId, amount: amount, txHash: txHash, reqId: reqId };

    const msgText = `📥 **New Deposit Request**\n\n` +
                    `👤 **User:** ${username || userId} (ID: \`${userId}\`)\n` +
                    `💰 **Amount:** ${amount} USDT\n` +
                    `🔑 **TxHash:** \`${txHash}\``;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "✅ Approve", callback_data: `approve_${reqId}` },
                { text: "❌ Reject", callback_data: `reject_${reqId}` }
            ]
        ]
    };

    await sendTelegramMessage(ADMIN_ID, msgText, keyboard);

    res.json({ success: true, message: "Deposit request submitted successfully" });
});

// Withdraw API from Mini App
app.post('/api/withdraw', async (req, res) => {
    const { userId, username, amount, address } = req.body;
    if (!userId || !amount || !address) return res.status(400).json({ success: false, message: "Missing data" });

    if (!users[userId] || users[userId].balance < parseFloat(amount)) {
        return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    const reqId = 'wd_' + Date.now();
    const withdrawItem = { id: reqId, amount: amount, address: address, status: 'PENDING', date: new Date().toLocaleDateString() };

    users[userId].withdrawals.unshift(withdrawItem);
    pendingRequests[reqId] = { type: 'withdraw', userId: userId, amount: amount, address: address, reqId: reqId };

    const msgText = `📤 **New Withdrawal Request**\n\n` +
                    `👤 **User:** ${username || userId} (ID: \`${userId}\`)\n` +
                    `💰 **Amount:** ${amount} USDT\n` +
                    `🏦 **Wallet Address:** \`${address}\``;

    const keyboard = {
        inline_keyboard: [
            [
                { text: "✅ Approve", callback_data: `approve_${reqId}` },
                { text: "❌ Reject", callback_data: `reject_${reqId}` }
            ]
        ]
    };

    await sendTelegramMessage(ADMIN_ID, msgText, keyboard);

    res.json({ success: true, message: "Withdrawal request submitted successfully" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    // Automatically set webhook on startup
    const RENDER_URL = "https://bitharvest-qtyp.onrender.com";
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${RENDER_URL}/api/webhook/${BOT_TOKEN}`);
        console.log("Telegram Webhook Set Successfully!");
    } catch (e) {
        console.log("Failed to set webhook:", e);
    }
});
