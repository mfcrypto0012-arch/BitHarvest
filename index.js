const express = require('express');
const fs = require('fs');
const app = express();

const BOT_TOKEN = '8655058369:AAGo-4rFve2eK21RbVk6CXc6e2_wwbrLCCQ';
const ADMIN_ID = '7482625921';
const DB_FILE = './users.json';

app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
});

// Load users from file if exists
let users = {};
if (fs.existsSync(DB_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        console.log("Error reading DB file:", e);
        users = {};
    }
}

// Function to save users to file
function saveDatabase() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
    } catch (e) {
        console.log("Error saving DB file:", e);
    }
}

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

// Telegram Webhook Handler
app.post(`/api/webhook/${BOT_TOKEN}`, async (req, res) => {
    const update = req.body;
    res.sendStatus(200);

    try {
        if (update.message) {
            const msg = update.message;
            const chatId = String(msg.chat.id);
            const text = msg.text || '';

            // --- /start Command & Referral Link Logic ---
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
                    saveDatabase();
                }

                await sendTelegramMessage(chatId, "🚀 **Welcome to BitHarvest USDT Mining Mini App!**\n\nClick the **Open BitHarvest** button below to launch the app.");
            }

            // --- Admin Panel Command ---
            if (text === '/admin') {
                if (chatId !== String(ADMIN_ID)) return;
                await sendTelegramMessage(chatId, "👑 **Admin Panel Commands:**\n\n📊 `/stats` - Total Bot Users\n👤 `/user <id>` or `/users <id>` - Check User Details\n➕ `/addbal <id> <amount>` - Add Balance\n➖ `/cutbal <id> <amount>` - Cut Balance\n📢 `/broadcast <message>` - Send to All");
            }

            // --- Admin: Total Users Check (/stats) ---
            if (text === '/stats') {
                if (chatId !== String(ADMIN_ID)) return;
                const totalUsers = Object.keys(users).length;
                await sendTelegramMessage(chatId, `📊 **Bot Statistics:**\n\n👥 **Total Registered Users:** ${totalUsers}`);
            }

            // --- Admin: Check User Details (/user <id> or /users <id>) ---
            if (text.startsWith('/user') || text.startsWith('/users')) {
                if (chatId !== String(ADMIN_ID)) return;
                const targetId = text.split(' ')[1];
                if (!targetId) return sendTelegramMessage(chatId, "⚠️ Usage: `/user <id>`");
                const u = users[targetId];
                if (!u) return sendTelegramMessage(chatId, "User not found in database!");

                // Calculate total approved deposits
                const totalDeposit = (u.deposits || [])
                    .filter(d => d.status === 'PAID')
                    .reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);

                // Calculate total approved withdrawals
                const totalWithdraw = (u.withdrawals || [])
                    .filter(w => w.status === 'PAID')
                    .reduce((sum, w) => sum + parseFloat(w.amount || 0), 0);

                // Calculate total referrals count
                const l1 = u.referrals?.level1?.length || 0;
                const l2 = u.referrals?.level2?.length || 0;
                const l3 = u.referrals?.level3?.length || 0;
                const totalReferrals = l1 + l2 + l3;

                const userDetailsMsg = `👤 **User Info (${targetId})**\n` +
                    `Username: @${u.username}\n` +
                    `Balance: ${u.balance.toFixed(4)} USDT\n` +
                    `GHS Power: ${u.ghs}\n` +
                    `Referred By: ${u.referredBy || 'None'}\n` +
                    `👥 Total Referrals: ${totalReferrals} (L1:${l1}, L2: ${l2}, L3:${l3})\n` +
                    `📥 Total Deposit: ${totalDeposit.toFixed(2)} USDT\n` +
                    `📤 Total Withdraw: ${totalWithdraw.toFixed(2)} USDT`;

                await sendTelegramMessage(chatId, userDetailsMsg);
            }

            // --- Admin: Add Balance ---
            if (text.startsWith('/addbal')) {
                if (chatId !== String(ADMIN_ID)) return;
                const parts = text.split(' ');
                const targetId = parts[1];
                const amount = parseFloat(parts[2]);

                if (!targetId || isNaN(amount)) return sendTelegramMessage(chatId, "⚠️ Usage: `/addbal <id> <amount>`");
                if (!users[targetId]) return sendTelegramMessage(chatId, "User not found!");

                users[targetId].balance += amount;
                saveDatabase();
                sendTelegramMessage(chatId, `✅ Successfully added ${amount} USDT to User${targetId}`);
                sendTelegramMessage(targetId, `💰 Admin added ${amount} USDT to your balance!`).catch(() => {});
            }

            // --- Admin: Cut Balance ---
            if (text.startsWith('/cutbal')) {
                if (chatId !== String(ADMIN_ID)) return;
                const parts = text.split(' ');
                const targetId = parts[1];
                const amount = parseFloat(parts[2]);

                if (!targetId || isNaN(amount)) return sendTelegramMessage(chatId, "⚠️ Usage: `/cutbal <id> <amount>`");
                if (!users[targetId]) return sendTelegramMessage(chatId, "User not found!");

                users[targetId].balance -= amount;
                saveDatabase();
                sendTelegramMessage(chatId, `✅ Successfully deducted ${amount} USDT from User${targetId}`);
                sendTelegramMessage(targetId, `⚠️ Admin deducted ${amount} USDT from your balance.`).catch(() => {});
            }

            // --- Admin: Broadcast Message ---
            if (text.startsWith('/broadcast')) {
                if (chatId !== String(ADMIN_ID)) return;
                const messageText = text.replace('/broadcast', '').trim();
                if (!messageText) return sendTelegramMessage(chatId, "⚠️ Usage: `/broadcast <message>`");

                let count = 0;
                Object.keys(users).forEach(id => {
                    sendTelegramMessage(id, `📢 **Announcement:**\n\n${messageText}`).catch(() => {});
                    count++;
                });

                sendTelegramMessage(chatId, `✅ Broadcast sent to ${count} users!`);
            }

        } else if (update.callback_query) {
            const query = update.callback_query;
            const chatId = String(query.message.chat.id);
            const data = query.data;
            const messageId = query.message.message_id;

            // --- Deposit / Withdrawal Approvals ---
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

                            // 3-Level Commission Distribution
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
                        sendTelegramMessage(req.userId, `✅ Your deposit of ${req.amount} USDT has been approved!${req.amount} GHS Power added.`);
                    } else if (req.type === 'withdraw') {
                        if (u) {
                            u.balance -= parseFloat(req.amount);
                            const wd = u.withdrawals.find(w => w.id === req.reqId);
                            if (wd) wd.status = 'PAID';
                        }
                        sendTelegramMessage(req.userId, `✅ Your withdrawal of ${req.amount} USDT has been approved!`);
                    }
                    editTelegramMessage(chatId, messageId, `✅ **Request Approved**\nUser ID: ${req.userId}\nAmount:${req.amount} USDT`);
                } else {
                    if (req.type === 'deposit') {
                        if (u) {
                            const dep = u.deposits.find(d => d.id === req.reqId);
                            if (dep) dep.status = 'DECLINED';
                        }
                        sendTelegramMessage(req.userId, `❌ Your deposit request of ${req.amount} USDT was rejected.`);
                    } else if (req.type === 'withdraw') {
                        if (u) {
                            const wd = u.withdrawals.find(w => w.id === req.reqId);
                            if (wd) wd.status = 'DECLINED';
                        }
                        sendTelegramMessage(req.userId, `❌ Your withdrawal request of ${req.amount} USDT was rejected.`);
                    }
                    editTelegramMessage(chatId, messageId, `❌ **Request Rejected**\nUser ID: ${req.userId}\nAmount:${req.amount} USDT`);
                }

                saveDatabase();
                delete pendingRequests[reqKey];
                answerCallbackQuery(query.id, "Done!");
            }
        }
    } catch (err) {
        console.log("Webhook error:", err);
    }
});

// User Data API for Mini App
app.get('/api/user/:userId', (req, res) => {
    const userId = req.params.userId;
    if (!users[userId]) {
        users[userId] = {
            id: userId,
            username: 'User',
            balance: 0,
            ghs: 0,
            lastClaimTime: Date.now(),
            deposits: [],
            withdrawals: [],
            referredBy: null,
            referrals: { level1: [], level2: [], level3: [] },
            refEarnings: { level1: 0, level2: 0, level3: 0 }
        };
        saveDatabase();
    }
    res.json(users[userId]);
});

// Claim Mining API
app.post('/api/claim', (req, res) => {
    const { userId } = req.body;
    const u = users[userId];
    if (!u) return res.status(400).json({ success: false, message: "User not found" });

    let dailyProfit = u.ghs > 0 ? u.ghs * 0.3 : 0.01;
    let perSecondRate = dailyProfit / 86400;
    let elapsedSeconds = (Date.now() - u.lastClaimTime) / 1000;
    let MinedAmount = Math.max(0, elapsedSeconds * perSecondRate);

    u.balance += MinedAmount;
    u.lastClaimTime = Date.now();
    saveDatabase();

    res.json({ success: true, balance: u.balance, lastClaimTime: u.lastClaimTime });
});

// Deposit API
app.post('/api/deposit', async (req, res) => {
    const { userId, username, amount, txHash } = req.body;
    if (!userId || !amount) return res.status(400).json({ success: false, message: "Missing data" });

    if (!users[userId]) {
        users[userId] = { id: userId, username: username || 'User', balance: 0, ghs: 0, lastClaimTime: Date.now(), deposits: [], withdrawals: [], referredBy: null, referrals: { level1: [], level2: [], level3: [] }, refEarnings: { level1: 0, level2: 0, level3: 0 } };
    }

    const reqId = 'dep_' + Date.now();
    const depositItem = { id: reqId, amount: amount, txHash: txHash, status: 'PENDING', date: new Date().toLocaleDateString() };
    
    users[userId].deposits.unshift(depositItem);
    pendingRequests[reqId] = { type: 'deposit', userId: userId, amount: amount, txHash: txHash, reqId: reqId };
    saveDatabase();

    const msgText = `📥 **New Deposit Request**\n\n` +
                    `👤 **User:** ${username || userId} (ID: \`${userId}\`)\n` +
                    `💰 **Amount:** ${amount} USDT\n` +
                    `🔑 **TxHash:** \`${txHash}\``;

    const keyboard = {
        inline_keyboard: [
            [{ text: "✅ Approve", callback_data: `approve_${reqId}` }, { text: "❌ Reject", callback_data: `reject_${reqId}` }]
        ]
    };

    await sendTelegramMessage(ADMIN_ID, msgText, keyboard);
    res.json({ success: true, message: "Deposit request submitted successfully" });
});

// Withdraw API
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
    saveDatabase();

    const msgText = `📤 **New Withdrawal Request**\n\n` +
                    `👤 **User:** ${username || userId} (ID: \`${userId}\`)\n` +
                    `💰 **Amount:** ${amount} USDT\n` +
                    `🏦 **Wallet Address:** \`${address}\``;

    const keyboard = {
        inline_keyboard: [
            [{ text: "✅ Approve", callback_data: `approve_${reqId}` }, { text: "❌ Reject", callback_data: `reject_${reqId}` }]
        ]
    };

    await sendTelegramMessage(ADMIN_ID, msgText, keyboard);
    res.json({ success: true, message: "Withdrawal request submitted successfully" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    const RENDER_URL = "https://bitharvest-qtyp.onrender.com";
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${RENDER_URL}/api/webhook/${BOT_TOKEN}`);
        console.log("Telegram Webhook Set Successfully!");
    } catch (e) {
        console.log("Failed to set webhook:", e);
    }
});
