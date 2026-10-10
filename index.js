const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const app = express();

const BOT_TOKEN = '8655058369:AAGo-4rFve2eK21RbVk6CXc6e2_wwbrLCCQ';
const ADMIN_ID = '7482625921';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
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

// Telegram /start command
bot.onText(/\/start (.+)?/, (msg, match) => {
    const chatId = msg.chat.id;
    const referrerId = match[1];

    if (!users[chatId]) {
        users[chatId] = {
            id: chatId,
            username: msg.chat.username || msg.chat.first_name || 'User',
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
                [{ text: "⛏️ Open Mining App", web_app: { url: "https://bitharvest.netlify.app" } }]
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

    bot.sendMessage(msg.chat.id, `👤 **User Info (${targetId})**\nUsername: @${u.username \vert{}\vert{} 'None'}\nBalance:${u.balance} USDT\nGHS Power: ${u.ghs}\nReferred By:${u.referredBy || 'None'}`);
});

// Add Balance Command
bot.onText(/\/addbal(?:\s+(\d+)\s+(.+))?/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const targetId = match[1];
    const amount = parseFloat(match[2]);

    if (!targetId || isNaN(amount)) return bot.sendMessage(msg.chat.id, "⚠️ Usage: /addbal <id> <amount>");
    if (!users[targetId]) return bot.sendMessage(msg.chat.id, "User not found in database!");
    
    users[targetId].balance += amount;
    bot.sendMessage(msg.chat.id, `✅ Successfully added ${amount} USDT to User${targetId}`);
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
    bot.sendMessage(msg.chat.id, `✅ Successfully deducted ${amount} USDT from User${targetId}`);
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
app.post('/api/deposit', (req, res) => {
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

    bot.sendMessage(ADMIN_ID, msgText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "✅ Approve", callback_data: `approve_${reqId}` },
                    { text: "❌ Reject", callback_data: `reject_${reqId}` }
                ]
            ]
        }
    });

    res
