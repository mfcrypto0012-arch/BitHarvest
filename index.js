const express = require('express');
const mongoose = require('mongoose');
const app = express();

// حساس معلومات Render Environment Variables سے لی جا رہی ہیں
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas Successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Mongoose User Schema
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

// MongoDB Pending Requests Schema (ڈیٹا محفوظ رکھنے کے لیے)
const pendingRequestSchema = new mongoose.Schema({
    reqId: { type: String, required: true, unique: true },
    type: { type: String, required: true }, // 'deposit' or 'withdraw'
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
                await sendTelegramMessage(chatId, "🚀 **Welcome to BitHarvest USDT Mining Mini App!**\n\nClick the button below to launch.");
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

                if (!req) return answerCallbackQuery(query.id, "Request already handled or expired!");

                const u = await User.findOne({ id: req.userId });

                if (isApprove) {
                    if (req.type === 'deposit') {
                        if (u) {
                            const depAmount = parseFloat(req.amount);
                            u.ghs += depAmount;
                            const dep = u.deposits.find(d => d.id === req.reqId);
                            if (dep) dep.status = 'PAID';
                            await u.save();
                        }
                        sendTelegramMessage(req.userId, `✅ Your deposit of ${req.amount} USDT has been approved!`);
                    } else if (req.type === 'withdraw') {
                        if (u) {
                            u.balance -= parseFloat(req.amount);
                            const wd = u.withdrawals.find(w => w.id === req.reqId);
                            if (wd) wd.status = 'PAID';
                            await u.save();
                        }
                        sendTelegramMessage(req.userId, `✅ Your withdrawal of ${req.amount} USDT has been approved!`);
                    }
                    editTelegramMessage(chatId, messageId, `✅ **Request Approved**\nUser ID: ${req.userId}\nAmount: ${req.amount} USDT`);
                } else {
                    if (req.type === 'deposit' && u) {
                        const dep = u.deposits.find(d => d.id === req.reqId);
                        if (dep) dep.status = 'DECLINED';
                        await u.save();
                    } else if (req.type === 'withdraw' && u) {
                        const wd = u.withdrawals.find(w => w.id === req.reqId);
                        if (wd) wd.status = 'DECLINED';
                        await u.save();
                    }
                    editTelegramMessage(chatId, messageId, `❌ **Request Rejected**\nUser ID: ${req.userId}\nAmount: ${req.amount} USDT`);
                }

                await PendingRequest.deleteOne({ reqId });
                answerCallbackQuery(query.id, "Done!");
            }
        }
    } catch (err) {
        console.log("Webhook error:", err);
    }
});

// --- Web Admin Dashboard Route ---
app.get('/admin/dashboard', async (req, res) => {
    const adminKey = req.query.key;
    if (adminKey !== ADMIN_ID) {
        return res.status(403).send("<h1>Unauthorized Access! Invalid key.</h1>");
    }

    const requests = await PendingRequest.find({ status: 'PENDING' });
    const totalUsers = await User.countDocuments();

    let html = `
        <html>
        <head><title>BitHarvest Admin Panel</title></head>
        <body style="font-family: Arial; padding: 20px; background: #121212; color: #fff;">
            <h1>👑 BitHarvest Admin Dashboard</h1>
            <p>👥 Total Users: <b>${totalUsers}</b></p>
            <hr>
            <h2>⏳ Pending Requests</h2>
    `;

    if (requests.length === 0) {
        html += `<p>No pending requests right now.</p>`;
    } else {
        html += `<table border="1" cellpadding="10" style="border-collapse: collapse; width: 100%; background: #1e1e1e;">
            <tr><th>Type</th><th>User ID</th><th>Amount</th><th>Details</th><th>Action</th></tr>`;
        
        for (let r of requests) {
            html += `<tr>
                <td>${r.type.toUpperCase()}</td>
                <td>${r.userId}</td>
                <td>${r.amount} USDT</td>
                <td>${r.txHash ? 'Tx: ' + r.txHash : 'Address: ' + r.address}</td>
                <td>
                    <button onclick="handleReq('${r.reqId}', 'approve')" style="background: green; color: white; padding: 5px 10px; cursor: pointer;">Approve</button>
                    <button onclick="handleReq('${r.reqId}', 'reject')" style="background: red; color: white; padding: 5px 10px; cursor: pointer;">Reject</button>
                </td>
            </tr>`;
        }
        html += `</table>`;
    }

    html += `
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
        </script>
        </body></html>
    `;
    res.send(html);
});

// Admin Dashboard Action Route
app.post('/admin/action', async (req, res) => {
    const { reqId, action, adminKey } = req.body;
    if (adminKey !== ADMIN_ID) return res.status(403).json({ success: false, message: "Unauthorized" });

    const reqDoc = await PendingRequest.findOne({ reqId });
    if (!reqDoc) return res.status(404).json({ success: false, message: "Request not found" });

    const u = await User.findOne({ id: reqDoc.userId });

    if (action === 'approve') {
        if (reqDoc.type === 'deposit' && u) {
            u.ghs += reqDoc.amount;
            const dep = u.deposits.find(d => d.id === reqDoc.reqId);
            if (dep) dep.status = 'PAID';
            await u.save();
            sendTelegramMessage(reqDoc.userId, `✅ Your deposit of ${reqDoc.amount} USDT approved via Web Admin!`);
        } else if (reqDoc.type === 'withdraw' && u) {
            u.balance -= reqDoc.amount;
            const wd = u.withdrawals.find(w => w.id === reqDoc.reqId);
            if (wd) wd.status = 'PAID';
            await u.save();
            sendTelegramMessage(reqDoc.userId, `✅ Your withdrawal of ${reqDoc.amount} USDT approved via Web Admin!`);
        }
    } else {
        if (reqDoc.type === 'deposit' && u) {
            const dep = u.deposits.find(d => d.id === reqDoc.reqId);
            if (dep) dep.status = 'DECLINED';
            await u.save();
            sendTelegramMessage(reqDoc.userId, `❌ Your deposit was rejected.`);
        } else if (reqDoc.type === 'withdraw' && u) {
            const wd = u.withdrawals.find(w => w.id === reqDoc.reqId);
            if (wd) wd.status = 'DECLINED';
            await u.save();
            sendTelegramMessage(reqDoc.userId, `❌ Your withdrawal was rejected.`);
        }
    }

    await PendingRequest.deleteOne({ reqId });
    res.json({ success: true, message: "Action executed successfully!" });
});

// APIs for Mini App
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

    res.json({ success: true, message: "Withdrawal request submitted successfully" });
});

const PORT = process.env.PORT || 3000;
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
