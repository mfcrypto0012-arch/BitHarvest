const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const app = express();

const BOT_TOKEN = '8655058369:AAGo-4rFve2eK21RbVk6CXc6e2_wwbrLCCQ';
const ADMIN_ID = '7482625921';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());
app.use(cors());

let users = {};
let pendingRequests = {};

// Telegram /start command
bot.onText(/\/start (.+)?/, (msg, match) => {
    const chatId = msg.chat.id;
    const referrerId = match[1];

    if (!users[chatId]) {
        users[chatId] = {
            id: chatId,
            balance: 0,
            ghs: 0,
            deposits: [],
            withdrawals: [],
            referredBy: referrerId || null,
            referrals: { level1: [], level2: [], level3: [] }
        };

        if (referrerId && users[referrerId]) {
            users[referrerId].referrals.level1.push(chatId);
            bot.sendMessage(referrerId, `🎉 New Referral Joined! User ID: ${chatId}`);
        }
    }

    bot.sendMessage(chatId, "🚀 Welcome to BitHarvest USDT Mining Mini App!", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "⛏️ Open Mining App", web_app: { url: "YOUR_NETLIFY_APP_URL" } }]
            ]
        }
    });
});

// Admin Panel Command
bot.onText(/\/admin/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    bot.sendMessage(msg.chat.id, "👑 **Admin Panel**\n\nCommands:\n/user <id> - Check User Details\n/addbal <id> <amount> - Add Balance\n/cutbal <id> <amount> - Cut Balance\n/broadcast <message> - Send to All Users");
});

// Check User Details Command
bot.onText(/\/user(?:\s+(.+))?/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const targetId = match[1];
    if (!targetId) return bot.sendMessage(msg.chat.id, "⚠️ Usage: /user <id>");
    const u = users[targetId];
    if (!u) return bot.sendMessage(msg.chat.id, "User not found!");

    bot.sendMessage(msg.chat.id, `👤 **User Info (${targetId})**\nBalance: ${u.balance} USDT\nGHS Power: ${u.ghs}\nReferred By: ${u.referredBy || 'None'}\nLevel 1 Referrals: ${u.referrals.level1.length}`);
});

// Add Balance Command
bot.onText(/\/addbal(?:\s+(\d+)\s+(.+))?/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const targetId = match[1];
    const amount = parseFloat(match[2]);

    if (!targetId || isNaN(amount)) return bot.sendMessage(msg.chat.id, "⚠️ Usage: /addbal <id> <amount>");
    if (!users[targetId]) return bot.sendMessage(msg.chat.id, "User not found in database!");
    
    users[targetId].balance += amount;
    bot.sendMessage(msg.chat.id, `✅ Successfully added ${amount} USDT to User ${targetId}`);
    bot.sendMessage(targetId, `💰 Admin added ${amount} USDT to your balance!`).catch(() => {});
});

// Cut Balance Command
bot.onText(/\/cutbal(?:\s+(\d+)\s+(.+))?/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const targetId = match[1];
    const amount = parseFloat(match[2]);

    if (!targetId || isNaN(amount)) return bot.sendMessage(msg.chat.id, "⚠️ Usage: /cutbal <id> <amount>");
    if (!users[targetId]) return bot.sendMessage(msg.chat.id, "User not found in database!");
    
    users[targetId].balance -= amount;
    bot.sendMessage(msg.chat.id, `✅ Successfully deducted ${amount} USDT from User ${targetId}`);
    bot.sendMessage(targetId, `⚠️ Admin deducted ${amount} USDT from your balance.`).catch(() => {});
});

// Broadcast Command
bot.onText(/\/broadcast(?:\s+(.+))?/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const text = match[1];
    if (!text) return bot.sendMessage(msg.chat.id, "⚠️ Usage: /broadcast <message>");
    
    let count = 0;
    Object.keys(users).forEach(id => {
        bot.sendMessage(id, `📢 **Announcement:**\n\n${text}`).catch(() => {});
        count++;
    });

    bot.sendMessage(msg.chat.id, `✅ Broadcast sent to ${count} users!`);
});

// API to get user data for Mini App
app.get('/api/user/:userId', (req, res) => {
    const userId = req.params.userId;
    if (!users[userId]) {
        users[userId] = {
            id: userId,
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
app.post('/api/deposit', (req, res) => {
    const { userId, amount } = req.body;
    if (!userId || !amount) return res.status(400).json({ success: false, message: "Missing data" });

    if (!users[userId]) {
        users[userId] = { id: userId, balance: 0, ghs: 0, deposits: [], withdrawals: [], referredBy: null, referrals: { level1: [], level2: [], level3: [] } };
    }

    const reqId = 'dep_' + Date.now();
    const depositItem = { id: reqId, amount: amount, status: 'PENDING', date: new Date().toLocaleDateString() };
    
    users[userId].deposits.push(depositItem);
    pendingRequests[reqId] = { type: 'deposit', userId: userId, amount: amount, reqId: reqId };

    bot.sendMessage(ADMIN_ID, `📥 **New Deposit Request from Mini App**\n\nUser ID: ${userId}\nAmount: ${amount} USDT`, {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "✅ Approve", callback_data: `approve_${reqId}` },
                    { text: "❌ Reject", callback_data: `reject_${reqId}` }
                ]
            ]
        }
    });

    res.json({ success: true, message: "Deposit request submitted successfully" });
});

// Withdraw API from Mini App
app.post('/api/withdraw', (req, res) => {
    const { userId, amount } = req.body;
    if (!userId || !amount) return res.status(400).json({ success: false, message: "Missing data" });

    if (!users[userId] || users[userId].balance < parseFloat(amount)) {
        return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    const reqId = 'wd_' + Date.now();
    const withdrawItem = { id: reqId, amount: amount, status: 'PENDING', date: new Date().toLocaleDateString() };

    users[userId].withdrawals.push(withdrawItem);
    pendingRequests[reqId] = { type: 'withdraw', userId: userId, amount: amount, reqId: reqId };

    bot.sendMessage(ADMIN_ID, `📤 **New Withdrawal Request from Mini App**\n\nUser ID: ${userId}\nAmount: ${amount} USDT`, {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "✅ Approve", callback_data: `approve_${reqId}` },
                    { text: "❌ Reject", callback_data: `reject_${reqId}` }
                ]
            ]
        }
    });

    res.json({ success: true, message: "Withdrawal request submitted successfully" });
});

// Telegram Callback Query Handler (Approve / Reject buttons)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data.startsWith('approve_') || data.startsWith('reject_')) {
        if (String(chatId) !== String(ADMIN_ID)) {
            return bot.answerCallbackQuery(query.id, { text: "Unauthorized!" });
        }

        const isApprove = data.startsWith('approve_');
        const reqKey = data.replace(isApprove ? 'approve_' : 'reject_', '');
        const req = pendingRequests[reqKey];

        if (!req) {
            return bot.answerCallbackQuery(query.id, { text: "Request already handled or expired!" });
        }

        const u = users[req.userId];

        if (isApprove) {
            if (req.type === 'deposit') {
                if (u) {
                    u.balance += parseFloat(req.amount);
                    const dep = u.deposits.find(d => d.id === req.reqId);
                    if (dep) dep.status = 'PAID';
                }
                bot.sendMessage(req.userId, `✅ Your deposit of ${req.amount} USDT has been approved and added to your balance!`);
            } else if (req.type === 'withdraw') {
                if (u) {
                    u.balance -= parseFloat(req.amount);
                    const wd = u.withdrawals.find(w => w.id === req.reqId);
                    if (wd) wd.status = 'PAID';
                }
                bot.sendMessage(req.userId, `✅ Your withdrawal of ${req.amount} USDT has been approved and processed!`);
            }
            bot.editMessageText(`✅ **Request Approved**\nUser: ${req.userId}\nAmount: ${req.amount} USDT`, {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        } else {
            if (req.type === 'deposit') {
                if (u) {
                    const dep = u.deposits.find(d => d.id === req.reqId);
                    if (dep) dep.status = 'DECLINED';
                }
                bot.sendMessage(req.userId, `❌ Your deposit request of ${req.amount} USDT was rejected by admin.`);
            } else if (req.type === 'withdraw') {
                if (u) {
                    const wd = u.withdrawals.find(w => w.id === req.reqId);
                    if (wd) wd.status = 'DECLINED';
                }
                bot.sendMessage(req.userId, `❌ Your withdrawal request of ${req.amount} USDT was rejected by admin.`);
            }
            bot.editMessageText(`❌ **Request Rejected**\nUser: ${req.userId}\nAmount: ${req.amount} USDT`, {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        }

        delete pendingRequests[reqKey];
        bot.answerCallbackQuery(query.id, { text: "Done!" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
