const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const app = express();

const BOT_TOKEN = '8655058369:AAGo-4rFve2eK21RbVk6CXc6e2_wwbrLCCQ';
const ADMIN_ID = '7482625921';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());

let users = {};

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
            inline_keyboard: [[{ text: "⛏️ Open Mining App", web_app: { url: "YOUR_NETLIFY_APP_URL" } }]]
        }
    });
});

bot.onText(/\/admin/, (msg) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    bot.sendMessage(msg.chat.id, "👑 **Admin Panel**\n\nCommands:\n/user <id> - Check User Details\n/addbal <id> <amount> - Add Balance\n/cutbal <id> <amount> - Cut Balance\n/broadcast <message> - Send to All Users");
});

bot.onText(/\/user (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const targetId = match[1];
    const u = users[targetId];
    if (!u) return bot.sendMessage(msg.chat.id, "User not found!");

    bot.sendMessage(msg.chat.id, `👤 **User Info (${targetId})**\nBalance: ${u.balance} USDT\nGHS Power: ${u.ghs}\nReferred By: ${u.referredBy || 'None'}\nLevel 1 Referrals: ${u.referrals.level1.length}`);
});

bot.onText(/\/addbal (\d+) (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const targetId = match[1];
    const amount = parseFloat(match[2]);

    if (!users[targetId]) return bot.sendMessage(msg.chat.id, "User not found in database!");
    users[targetId].balance += amount;

    bot.sendMessage(msg.chat.id, `✅ Successfully added ${amount} USDT to User ${targetId}`);
    bot.sendMessage(targetId, `💰 Admin added ${amount} USDT to your balance!`);
});

bot.onText(/\/cutbal (\d+) (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const targetId = match[1];
    const amount = parseFloat(match[2]);

    if (!users[targetId]) return bot.sendMessage(msg.chat.id, "User not found in database!");
    users[targetId].balance -= amount;

    bot.sendMessage(msg.chat.id, `✅ Successfully deducted ${amount} USDT from User ${targetId}`);
    bot.sendMessage(targetId, `⚠️ Admin deducted ${amount} USDT from your balance.`);
});

bot.onText(/\/broadcast (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== String(ADMIN_ID)) return;
    const text = match[1];
    let count = 0;

    Object.keys(users).forEach(id => {
        bot.sendMessage(id, `📢 **Announcement:**\n\n${text}`).catch(() => {});
        count++;
    });

    bot.sendMessage(msg.chat.id, `✅ Broadcast sent to ${count} users!`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
