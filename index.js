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

// Function to send Telegram messages via Telegram HTTP API directly (No extra package needed)
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
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
