const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const app = express();

const BOT_TOKEN = '8655058369:AAGo-4rFve2eK21RbVk6CXc6e2_wwbrLCCQ';
const ADMIN_ID = '7482625921';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

let users = {};
let pendingRequests = {};

bot.onText(/\/start (.+)?/, (msg, match) => {
    const chatId = msg.chat.id;
    const referrerId = match[1];

    if (!users[chatId]) {
        users[chatId] = {
            id: chatId,
            balance: 0,
            ghs: 0,
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
                [{ text: "⛏️ Open Mining App", web_app: { url: "YOUR_NETLIFY_APP_URL" } }],
                [{ text: "💰 Deposit", callback_data: "menu_deposit" }, { text: "📤 Withdraw", callback_data: "menu_withdraw" }]
            ]
        }
    });
});

bot.onText(/\/admin/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    bot.sendMessage(msg.chat.id, "👑 **Admin Panel**\n\nCommands:\n/user <id> - Check User Details\n/addbal <id> <amount> - Add Balance\n/cutbal <id> <amount> - Cut Balance\n/broadcast <message> - Send to All Users");
});

bot.onText(/\/user(?:\s+(.+))?/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const targetId = match[1];
    if (!targetId) return bot.sendMessage(msg.chat.id, "⚠️ Usage: /user <id>");
    const u = users[targetId];
    if (!u) return bot.sendMessage(msg.chat.id, "User not found!");

    bot.sendMessage(msg.chat.id, `👤 **User Info (${targetId})**\nBalance: ${u.balance} USDT\nGHS Power: ${u.ghs}\nReferred By: ${u.referredBy || 'None'}\nLevel 1 Referrals: ${u.referrals.level1.length}`);
});

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

bot.onText(/\/deposit(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const amount = match[1];
    if (!amount) {
        return bot.sendMessage(chatId, "💡 **How to Deposit:**\nSend your deposit amount like this:\n`/deposit 10`\n(Min: 5 USDT, BEP-20 Network)");
    }

    const reqId = 'dep_' + Date.now();
    pendingRequests[reqId] = { type: 'deposit', userId: chatId, amount: amount };

    bot.sendMessage(chatId, `⏳ Deposit request of ${amount} USDT submitted! Please wait for admin approval.`);
    
    bot.sendMessage(ADMIN_ID, `📥 **New Deposit Request**\n\nUser ID: ${chatId}\nAmount: ${amount} USDT`, {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "✅ Approve", callback_data: `approve_${reqId}` },
                    { text: "❌ Reject", callback_data: `reject_${reqId}` }
                ]
            ]
        }
    });
});

bot.onText(/\/withdraw(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const amount = match[1];
    if (!amount) {
        return bot.sendMessage(chatId, "💡 **How to Withdraw:**\nSend your withdrawal amount like this:\n`/withdraw 10`\n(Min: 10 USDT)");
    }

    if (!users[chatId] || users[chatId].balance < parseFloat(amount)) {
        return bot.sendMessage(chatId, "❌ Insufficient balance for withdrawal!");
    }

    const reqId = 'wd_' + Date.now();
    pendingRequests[reqId] = { type: 'withdraw', userId: chatId, amount: amount };

    bot.sendMessage(chatId, `⏳ Withdrawal request of ${amount} USDT submitted! Please wait for admin approval.`);
    
    bot.sendMessage(ADMIN_ID, `📤 **New Withdrawal Request**\n\nUser ID: ${chatId}\nAmount: ${amount} USDT`, {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "✅ Approve", callback_data: `approve_${reqId}` },
                    { text: "❌ Reject", callback_data: `reject_${reqId}` }
                ]
            ]
        }
    });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === 'menu_deposit') {
        return bot.sendMessage(chatId, "💡 To deposit, send: `/deposit <amount>` (e.g. `/deposit 10`)");
    }
    if (data === 'menu_withdraw') {
        return bot.sendMessage(chatId, "💡 To withdraw, send: `/withdraw <amount>` (e.g. `/withdraw 10`)");
    }

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

        if (isApprove) {
            if (req.type === 'deposit') {
                if (!users[req.userId]) {
                    users[req.userId] = { id: req.userId, balance: 0, ghs: 0, referredBy: null, referrals: { level1: [], level2: [], level3: [] } };
                }
                users[req.userId].balance += parseFloat(req.amount);
                bot.sendMessage(req.userId, `✅ Your deposit of ${req.amount} USDT has been approved and added to your balance!`);
            } else if (req.type === 'withdraw') {
                if (users[req.userId]) {
                    users[req.userId].balance -= parseFloat(req.amount);
                }
                bot.sendMessage(req.userId, `✅ Your withdrawal of ${req.amount} USDT has been approved and processed!`);
            }
            bot.editMessageText(`✅ **Request Approved**\nUser: ${req.userId}\nAmount: ${req.amount} USDT`, {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        } else {
            if (req.type === 'deposit') {
                bot.sendMessage(req.userId, `❌ Your deposit request of ${req.amount} USDT was rejected by admin.`);
            } else if (req.type === 'withdraw') {
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
