const express = require('express');
const mongoose = require('mongoose');
const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas Successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Mongoose Schemas
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

// Helper Functions for Telegram Bot
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
                await sendTelegramMessage(chatId, "🚀 **Welcome to BitHarvest USDT Mining Mini App!**\n\nClick the WebApp button below to launch.");
            } else if (text === '/admin' && chatId === String(ADMIN_ID)) {
                await sendTelegramMessage(chatId, `👑 **BitHarvest Admin Panel Access**\n\nClick below to open Full Admin Panel:`, {
                    inline_keyboard: [[
                        { text: "🌐 Open Admin Dashboard", url: `https://bitharvest-qtyp.onrender.com/admin/dashboard?key=${ADMIN_ID}` }
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

// --- Master Admin UI Dashboard Route ---
app.get('/admin/dashboard', async (req, res) => {
    const adminKey = req.query.key;
    if (adminKey !== ADMIN_ID) {
        return res.status(403).send("<h1>Unauthorized Access!</h1>");
    }

    const requests = await PendingRequest.find({});
    const totalUsers = await User.countDocuments();
    const allUsers = await User.find({});

    let totalBalances = allUsers.reduce((sum, u) => sum + (u.balance || 0), 0);
    let totalPaidOut = 0;
    allUsers.forEach(u => {
        if (u.withdrawals) {
            u.withdrawals.forEach(w => {
                if (w.status === 'PAID') totalPaidOut += parseFloat(w.amount || 0);
            });
        }
    });

    let searchId = req.query.search ? req.query.search.trim() : '';
    let searchedUser = null;
    if (searchId) {
        searchedUser = await User.findOne({
            $or: [{ id: searchId }, { username: searchId.replace('@', '') }]
        });
    }

    let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>BitHarvest Admin Panel</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
                body { background: #0c0a09; color: #f3f4f6; margin: 0; padding: 20px; }
                .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
                .header h1 { color: #f59e0b; margin: 0; font-size: 24px; }
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 25px; }
                .stat-card { background: #1c1917; border: 1px solid #292524; border-radius: 12px; padding: 15px; text-align: left; }
                .stat-title { font-size: 11px; color: #a8a29e; text-transform: uppercase; letter-spacing: 0.5px; }
                .stat-value { font-size: 20px; font-weight: bold; color: #fbbf24; margin-top: 6px; }
                
                .card { background: #1c1917; border: 1px solid #292524; border-radius: 12px; padding: 18px; margin-bottom: 20px; }
                .card h3 { color: #f59e0b; margin-top: 0; font-size: 16px; border-bottom: 1px solid #292524; padding-bottom: 8px; }
                
                .search-box { display: flex; gap: 10px; margin-bottom: 15px; }
                input, textarea { background: #0c0a09; border: 1px solid #44403c; color: #fff; padding: 10px; border-radius: 8px; width: 100%; font-size: 14px; }
                .btn { background: #f59e0b; color: #000; border: none; font-weight: bold; padding: 10px 18px; border-radius: 8px; cursor: pointer; }
                .btn-green { background: #22c55e; color: #fff; }
                .btn-red { background: #ef4444; color: #fff; }

                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                th, td { padding: 10px; text-align: left; border-bottom: 1px solid #292524; font-size: 12px; }
                th { color: #a8a29e; }
                
                .user-details-box { background: #0c0a09; padding: 12px; border-radius: 8px; border: 1px solid #292524; margin-top: 10px; font-size: 13px; line-height: 1.6; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>👑 BitHarvest Admin</h1>
                <span style="font-size: 12px; color: #22c55e;">● Live Connected</span>
            </div>

            <!-- Stats Overview Grid -->
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-title">Total Users</div>
                    <div class="stat-value">${totalUsers}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">User Balances</div>
                    <div class="stat-value">${totalBalances.toFixed(2)} USDT</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">Paid Out</div>
                    <div class="stat-value">${totalPaidOut.toFixed(2)} USDT</div>
                </div>
                <div class="stat-card">
                    <div class="stat-title">Pending Requests</div>
                    <div class="stat-value">${requests.length}</div>
                </div>
            </div>

            <!-- Search User Details Section -->
            <div class="card">
                <h3>🔍 Search User Details & Manage Balance</h3>
                <form method="GET" action="/admin/dashboard" class="search-box">
                    <input type="hidden" name="key" value="${ADMIN_ID}">
                    <input type="text" name="search" placeholder="Search by Telegram User ID or Username" value="${searchId}">
                    <button type="submit" class="btn">Search</button>
                </form>

                ${searchedUser ? `
                    <div class="user-details-box">
                        <p>👤 <b>User Name:</b> @${searchedUser.username} | <b>ID:</b> <code>${searchedUser.id}</code></p>
                        <p>💰 <b>Balance:</b> ${searchedUser.balance.toFixed(4)} USDT | ⚡ <b>GHS Power:</b> ${searchedUser.ghs} GHS</p>
                        <p>👥 <b>Referrals Count:</b> L1: ${searchedUser.referrals?.level1?.length || 0} | L2: ${searchedUser.referrals?.level2?.length || 0} | L3: ${searchedUser.referrals?.level3?.length || 0}</p>
                        <p>🔗 <b>Referred By:</b> ${searchedUser.referredBy || 'None'}</p>
                        
                        <hr style="border-color:#292524;">
                        <b>⚙️ Balance Add / Cut:</b>
                        <div style="display:flex; gap:10px; margin-top:8px;">
                            <input type="number" id="mod-amt" placeholder="Enter amount">
                            <button class="btn btn-green" onclick="modifyBal('${searchedUser.id}', 'add')">+ Add</button>
                            <button class="btn btn-red" onclick="modifyBal('${searchedUser.id}', 'cut')">- Cut</button>
                        </div>
                    </div>
                ` : searchId ? `<p style="color:#ef4444; font-size:12px;">User not found!</p>` : ''}
            </div>

            <!-- Pending Deposit & Withdrawal Requests -->
            <div class="card">
                <h3>⏳ Pending Requests (Deposit & Withdraw)</h3>
                ${requests.length === 0 ? `<p style="font-size:12px; color:#a8a29e;">No pending requests right now.</p>` : `
                    <table>
                        <tr><th>Type</th><th>User ID</th><th>Amount</th><th>Details</th><th>Action</th></tr>
                        ${requests.map(r => `
                            <tr>
                                <td><b style="color:${r.type==='deposit'?'#22c55e':'#ef4444'}">${r.type.toUpperCase()}</b></td>
                                <td>${r.userId}</td>
                                <td><b>${r.amount} USDT</b></td>
                                <td>${r.txHash ? 'Tx: ' + r.txHash.substring(0,10) + '...' : 'Addr: ' + r.address.substring(0,10) + '...'}</td>
                                <td>
                                    <button class="btn btn-green" style="padding:4px 8px; font-size:11px;" onclick="handleReq('${r.reqId}', 'approve')">Approve</button>
                                    <button class="btn btn-red" style="padding:4px 8px; font-size:11px;" onclick="handleReq('${r.reqId}', 'reject')">Reject</button>
                                </td>
                            </tr>
                        `).join('')}
                    </table>
                `}
            </div>

            <!-- Broadcast Section -->
            <div class="card">
                <h3>📢 Broadcast Message to All Users</h3>
                <textarea id="bc-msg" placeholder="Write message to send to all bot users..."></textarea>
                <button class="btn" style="margin-top:10px; width:100%;" onclick="sendBroadcast()">Send Broadcast Message</button>
            </div>

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

                async function modifyBal(userId, action) {
                    let amount = document.getElementById('mod-amt').value;
                    if(!amount) return alert("Enter amount!");
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
                    let message = document.getElementById('bc-msg').value;
                    if(!message) return alert("Type message!");
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

// Admin Action Handlers
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
            sendTelegramMessage(reqDoc.userId, `✅ Your deposit of ${reqDoc.amount} USDT has been approved!`);
        } else if (reqDoc.type === 'withdraw' && u) {
            u.balance -= parseFloat(reqDoc.amount);
            const wd = u.withdrawals.find(w => w.id === reqDoc.reqId);
            if (wd) wd.status = 'PAID';
            await u.save();
            sendTelegramMessage(reqDoc.userId, `✅ Your withdrawal of ${reqDoc.amount} USDT has been approved!`);
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

// App APIs
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
    if (!u) u = new User({ id: userId, username: username || 'User' });

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
