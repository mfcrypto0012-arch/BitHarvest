const express = require('express');
const mongoose = require('mongoose');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas Successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const userSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    username: { type: String, default: 'User' },
    balance: { type: Number, default: 0 },
    ghs: { type: Number, default: 0 },
    lastClaimTime: { type: Number, default: Date.now },
    deposits: { type: Array, default: [] },
    withdrawals: { type: Array, default: [] },
    referredBy: { type: String, default: null },
    referrals: {
        level1: { type: [String], default: [] },
        level2: { type: [String], default: [] },
        level3: { type: [String], default: [] }
    },
    refEarnings: {
        level1: { type: Number, default: 0 },
        level2: { type: Number, default: 0 },
        level3: { type: Number, default: 0 }
    }
});
const User = mongoose.model('User', userSchema);

const pendingRequestSchema = new mongoose.Schema({
    reqId: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    userId: { type: String, required: true },
    amount: { type: Number, required: true },
    txHash: { type: String },
    address: { type: String },
    status: { type: String, default: 'PENDING' }
});
const PendingRequest = mongoose.model('PendingRequest', pendingRequestSchema);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
});

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

            if (text.startsWith('/start')) {
                const parts = text.split(' ');
                const referrerId = parts[1] ? String(parts[1]) : null;

                let user = await User.findOne({ id: chatId });
                if (!user) {
                    user = new User({
                        id: chatId,
                        username: msg.from.username || msg.from.first_name || 'User',
                        referredBy: referrerId || null
                    });

                    if (referrerId && referrerId !== chatId) {
                        const referrer = await User.findOne({ id: referrerId });
                        if (referrer) {
                            user.referredBy = referrerId;
                            if (!referrer.referrals.level1.includes(chatId)) {
                                referrer.referrals.level1.push(chatId);
                                sendTelegramMessage(referrerId, `🎉 New Level 1 Referral Joined! ID: ${chatId}`);
                            }
                            await referrer.save();
                        }
                    }
                    await user.save();
                }
                await sendTelegramMessage(chatId, "🚀 **Welcome to BitHarvest USDT Mining Mini App!**\n\nClick below to launch.");
            } else if (text === '/admin' && chatId === String(ADMIN_ID)) {
                await sendTelegramMessage(chatId, `👑 **Admin Access Granted**\n\nClick below to open Full Admin Dashboard:`, {
                    inline_keyboard: [[
                        { text: "🌐 Open Full Admin Panel", url: `https://bitharvest-qtyp.onrender.com/admin/dashboard?key=${ADMIN_ID}` }
                    ]]
                });
            }
        } else if (update.callback_query) {
            const query = update.callback_query;
            const chatId = String(query.message.chat.id);
            const data = query.data;
            const messageId = query.message.message_id;

            if (data.startsWith('approve_') || data.startsWith('reject_')) {
                if (chatId !== String(ADMIN_ID)) return answerCallbackQuery(query.id, "Unauthorized!");

                const isApprove = data.startsWith('approve_');
                const reqId = data.replace(isApprove ? 'approve_' : 'reject_', '');
                const req = await PendingRequest.findOne({ reqId });

                if (!req) return answerCallbackQuery(query.id, "Request already handled!");

                const u = await User.findOne({ id: req.userId });

                if (isApprove) {
                    if (req.type === 'deposit' && u) {
                        u.ghs += parseFloat(req.amount);
                        const dep = u.deposits.find(d => d.id === req.reqId);
                        if (dep) dep.status = 'PAID';
                        await u.save();
                        sendTelegramMessage(req.userId, `✅ Your deposit of ${req.amount} USDT has been approved!`);
                    } else if (req.type === 'withdraw' && u) {
                        u.balance -= parseFloat(req.amount);
                        const wd = u.withdrawals.find(w => w.id === req.reqId);
                        if (wd) wd.status = 'PAID';
                        await u.save();
                        sendTelegramMessage(req.userId, `✅ Your withdrawal of ${req.amount} USDT has been approved!`);
                    }
                    editTelegramMessage(chatId, messageId, `✅ **Request Approved**\nUser ID: ${req.userId}\nAmount:${req.amount} USDT`);
                } else {
                    if (req.type === 'deposit' && u) {
                        const dep = u.deposits.find(d => d.id === req.reqId);
                        if (dep) dep.status = 'DECLINED';
                        await u.save();
                        sendTelegramMessage(req.userId, `❌ Your deposit was rejected.`);
                    } else if (req.type === 'withdraw' && u) {
                        const wd = u.withdrawals.find(w => w.id === req.reqId);
                        if (wd) wd.status = 'DECLINED';
                        await u.save();
                        sendTelegramMessage(req.userId, `❌ Your withdrawal was rejected.`);
                    }
                    editTelegramMessage(chatId, messageId, `❌ **Request Rejected**\nUser ID: ${req.userId}\nAmount:${req.amount} USDT`);
                }

                await PendingRequest.deleteOne({ reqId });
                answerCallbackQuery(query.id, "Done!");
            }
        }
    } catch (err) {
        console.log("Webhook error:", err);
    }
});

// --- Advanced Web Admin Dashboard ---
app.get('/admin/dashboard', async (req, res) => {
    const adminKey = req.query.key;
    if (adminKey !== ADMIN_ID) {
        return res.status(403).send("<h1>Unauthorized Access!</h1>");
    }

    const requests = await PendingRequest.find({});
    const totalUsers = await User.countDocuments();
    const users = await User.find({}).limit(50); // Show recent users

    let html = `
        <html>
        <head>
            <title>BitHarvest Master Admin Panel</title>
            <style>
                body { font-family: Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; }
                h1, h2 { color: #38bdf8; }
                .card { background: #1e293b; padding: 15px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
                table { width: 100%; border-collapse: collapse; background: #1e293b; margin-top: 10px; }
                th, td { padding: 10px; border: 1px solid #334155; text-align: left; font-size: 13px; }
                th { background: #334155; color: #38bdf8; }
                button { padding: 6px 12px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
                .btn-green { background: #22c55e; color: white; }
                .btn-red { background: #ef4444; color: white; }
                .btn-blue { background: #3b82f6; color: white; }
                input, textarea { padding: 8px; width: 100%; background: #0f172a; border: 1px solid #475569; color: white; border-radius: 5px; margin-top: 5px; margin-bottom: 10px; }
            </style>
        </head>
        <body>
            <h1>👑 BitHarvest Master Admin Panel</h1>
            <div class="card">
                <h3>📊 System Stats</h3>
                <p>👥 Total Registered Users: <b>${totalUsers}</b></p>
                <p>⏳ Pending Requests Count: <b>${requests.length}</b></p>
            </div>

            <div class="card">
                <h3>📢 Broadcast Message to All Users</h3>
                <textarea id="broadcast-msg" placeholder="Type message to send to all bot users..."></textarea>
                <button class="btn-blue" onclick="sendBroadcast()">Send Broadcast</button>
            </div>

            <div class="card">
                <h3>⚙️ User Balance Management (Add / Cut)</h3>
                <input type="text" id="manage-userid" placeholder="Enter User ID">
                <input type="number" id="manage-amount" placeholder="Enter USDT Amount">
                <div style="display: flex; gap: 10px;">
                    <button class="btn-green" onclick="modifyBalance('add')">Add Balance</button>
                    <button class="btn-red" onclick="modifyBalance('cut')">Cut Balance</button>
                </div>
            </div>

            <div class="card">
                <h2>⏳ Pending Requests (Deposit & Withdraw)</h2>
    `;

    if (requests.length === 0) {
        html += `<p>No pending requests.</p>`;
    } else {
        html += `<table>
            <tr><th>Type</th><th>User ID</th><th>Amount</th><th>Details</th><th>Action</th></tr>`;
        for (let r of requests) {
            html += `<tr>
                <td><b>${r.type.toUpperCase()}</b></td>
                <td>${r.userId}</td>
                <td>${r.amount} USDT</td>
                <td>${r.txHash ? 'Tx: ' + r.txHash : 'Address: ' + r.address}</td>
                <td>
                    <button class="btn-green" onclick="handleReq('${r.reqId}', 'approve')">Approve</button>
                    <button class="btn-red" onclick="handleReq('${r.reqId}', 'reject')">Reject</button>
                </td>
            </tr>`;
        }
        html += `</table>`;
    }

    html += `</div>
            <div class="card">
                <h2>👥 Recent Users List</h2>
                <table>
                    <tr><th>User ID</th><th>Username</th><th>Balance (USDT)</th><th>GHS Power</th></tr>`;
    for (let u of users) {
        html += `<tr>
            <td>${u.id}</td>
            <td>@${u.username}</td>
            <td>${u.balance.toFixed(4)}</td>
            <td>${u.ghs} GHS</td>
        </tr>`;
    }
    html += `</table></div>

        <script>
            async function handleReq(reqId, action) {
                let res = await fetch('/admin/action', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ reqId, action, adminKey: '${ADMIN_ID}' })
                });
                let data = await res.json();
                alert(data.message);
                location.reload();
            }

            async function modifyBalance(action) {
                let userId = document.getElementById('manage-userid').value;
                let amount = document.getElementById('manage-amount').value;
                let res = await fetch('/admin/manage-balance', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ userId, amount, action, adminKey: '${ADMIN_ID}' })
                });
                let data = await res.json();
                alert(data.message);
                location.reload();
            }

            async function sendBroadcast() {
                let message = document.getElementById('broadcast-msg').value;
                if(!message) return alert("Please type a message!");
                let res = await fetch('/admin/broadcast', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ message, adminKey: '${ADMIN_ID}' })
                });
                let data = await res.json();
                alert(data.message);
            }
        </script>
        </body>
        </html>
    `;
    res.send(html);
});

// Admin Actions API
app.post('/admin/action', async (req, res) => {
    const { reqId, action, adminKey } = req.body;
    if (adminKey !== ADMIN_ID) return res.status(403).json({ success: false, message: "Unauthorized" });

    const reqDoc = await PendingRequest.findOne({ reqId });
    if (!reqDoc) return res.status(404).json({ success: false, message: "Request not found" });

    const u = await User.findOne({ id: reqDoc.userId });

    if (action === 'approve') {
        if (reqDoc.type === 'deposit' && u) {
            u.ghs += parseFloat(reqDoc.amount);
            const dep = u.deposits.find(d => d.id === reqDoc.reqId);
            if (dep) dep.status = 'PAID';
            await u.save();
            sendTelegramMessage(reqDoc.userId, `✅ Your deposit of ${reqDoc.amount} USDT approved!`);
        } else if (reqDoc.type === 'withdraw' && u) {
            u.balance -= parseFloat(reqDoc.amount);
            const wd = u.withdrawals.find(w => w.id === reqDoc.reqId);
            if (wd) wd.status = 'PAID';
            await u.save();
            sendTelegramMessage(reqDoc.userId, `✅ Your withdrawal of ${reqDoc.amount} USDT approved!`);
        }
    } else {
        if (reqDoc.type === 'deposit' && u) {
            const dep = u.deposits.find(d => d.id === reqDoc.reqId);
            if (dep) dep.status = 'DECLINED';
            await u.save();
            sendTelegramMessage(reqDoc.userId, `❌ Your deposit request was declined.`);
        } else if (reqDoc.type === 'withdraw' && u) {
            const wd = u.withdrawals.find(w => w.id === reqDoc.reqId);
            if (wd) wd.status = 'DECLINED';
            await u.save();
            sendTelegramMessage(reqDoc.userId, `❌ Your withdrawal request was declined.`);
        }
    }

    await PendingRequest.deleteOne({ reqId });
    res.json({ success: true, message: "Action executed successfully!" });
});

// Balance Add / Cut API
app.post('/admin/manage-balance', async (req, res) => {
    const { userId, amount, action, adminKey } = req.body;
    if (adminKey !== ADMIN_ID) return res.status(403).json({ success: false, message: "Unauthorized" });

    let u = await User.findOne({ id: userId });
    if (!u) return res.status(404).json({ success: false, message: "User not found!" });

    let amt = parseFloat(amount);
    if (action === 'add') {
        u.balance += amt;
        sendTelegramMessage(userId, `🎁 Admin added +${amt} USDT to your balance!`);
    } else {
        u.balance = Math.max(0, u.balance - amt);
        sendTelegramMessage(userId, `⚠️ Admin deducted -${amt} USDT from your balance.`);
    }
    await u.save();
    res.json({ success: true, message: `Successfully ${action}ed ${amt} USDT for user${userId}!` });
});

// Broadcast API
app.post('/admin/broadcast', async (req, res) => {
    const { message, adminKey } = req.body;
    if (adminKey !== ADMIN_ID) return res.status(403).json({ success: false, message: "Unauthorized" });

    const users = await User.find({});
    let count = 0;
    for (let u of users) {
        await sendTelegramMessage(u.id, message);
        count++;
    }
    res.json({ success: true, message: `Broadcast sent to ${count} users successfully!` });
});

// Mini App APIs
app.get('/api/user/:userId', async (req, res) => {
    const userId = req.params.userId;
    let user = await User.findOne({ id: userId });
    if (!user) {
        user = new User({ id: userId, username: 'User' });
        await user.save();
    }
    res.json(user);
});

app.post('/api/claim', async (req, res) => {
    const { userId } = req.body;
    const u = await User.findOne({ id: userId });
    if (!u) return res.status(400).json({ success: false, message: "User not found" });

    let dailyProfit = u.ghs > 0 ? u.ghs * 0.3 : 0.01;
    let perSecondRate = dailyProfit / 86400;
    let elapsedSeconds = (Date.now() - u.lastClaimTime) / 1000;
    let MinedAmount = Math.max(0, elapsedSeconds * perSecondRate);

    u.balance += MinedAmount;
    u.lastClaimTime = Date.now();
    await u.save();

    res.json({ success: true, balance: u.balance, lastClaimTime: u.lastClaimTime });
});

app.post('/api/deposit', async (req, res) => {
    const { userId, username, amount, txHash } = req.body;
    if (!userId || !amount) return res.status(400).json({ success: false, message: "Missing data" });

    let u = await User.findOne({ id: userId });
    if (!u) {
        u = new User({ id: userId, username: username || 'User' });
    }

    const reqId = 'dep_' + Date.now();
    u.deposits.unshift({ id: reqId, amount, txHash, status: 'PENDING', date: new Date().toLocaleDateString() });
    await u.save();

    await PendingRequest.create({ reqId, type: 'deposit', userId, amount, txHash });

    if (ADMIN_ID) {
        const msgText = `📥 **New Deposit Request**\n\n👤 User ID: \`${userId}\`\n💰 Amount: **${amount} USDT**\n🔑 TxHash: \`${txHash}\``;
        const inlineKeyboard = {
            inline_keyboard: [[
                { text: "✅ Approve", callback_data: `approve_${reqId}` },
                { text: "❌ Reject", callback_data: `reject_${reqId}` }
            ]]
        };
        await sendTelegramMessage(ADMIN_ID, msgText, inlineKeyboard);
    }

    res.json({ success: true, message: "Deposit request submitted successfully" });
});

app.post('/api/withdraw', async (req, res) => {
    const { userId, username, amount, address } = req.body;
    if (!userId || !amount || !address) return res.status(400).json({ success: false, message: "Missing data" });

    let u = await User.findOne({ id: userId });
    if (!u || u.balance < parseFloat(amount)) {
        return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    const reqId = 'wd_' + Date.now();
    u.withdrawals.unshift({ id: reqId, amount, address, status: 'PENDING', date: new Date().toLocaleDateString() });
    await u.save();

    await PendingRequest.create({ reqId, type: 'withdraw', userId, amount, address });

    if (ADMIN_ID) {
        const msgText = `📤 **New Withdraw Request**\n\n👤 User ID: \`${userId}\`\n💰 Amount: **${amount} USDT**\n🏦 Address: \`${address}\``;
        const inlineKeyboard = {
            inline_keyboard: [[
                { text: "✅ Approve", callback_data: `approve_${reqId}` },
                { text: "❌ Reject", callback_data: `reject_${reqId}` }
            ]]
        };
        await sendTelegramMessage(ADMIN_ID, msgText, inlineKeyboard);
    }

    res.json({ success: true, message: "Withdrawal request submitted successfully" });
});

const PORT = process.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || "https://bitharvest-qtyp.onrender.com";
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${RENDER_URL}/api/webhook/${BOT_TOKEN}`);
        console.log("Telegram Webhook Set Successfully!");
    } catch (e) {
        console.log("Failed to set webhook:", e);
    }
});
