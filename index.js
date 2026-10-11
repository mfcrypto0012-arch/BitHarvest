const express = require('express');
const mongoose = require('mongoose');

const app = express();

// Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB Successfully!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

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
}, { minimize: false });

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
        if (!BOT_TOKEN) return;
        let body = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
        if (replyMarkup) body.reply_markup = replyMarkup;
        
        if (typeof fetch !== 'undefined') {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        }
    } catch (e) {
        console.log("Telegram Message Exception:", e.message);
    }
}

app.post(`/api/webhook/${BOT_TOKEN}`, async (req, res) => {
    res.sendStatus(200);
    try {
        const update = req.body;
        if (update && update.message) {
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
                                await sendTelegramMessage(referrerId, `🎉 New Level 1 Referral Joined! ID: ${chatId}`);
                            }
                            await referrer.save();
                        }
                    }
                    await user.save();
                }
                await sendTelegramMessage(chatId, "Welcome to BitHarvest Mining Mini App!");
            } else if (text === '/admin' && chatId === String(ADMIN_ID)) {
                await sendTelegramMessage(chatId, `Admin Dashboard Access:`, {
                    inline_keyboard: [[
                        { text: "Open Admin Dashboard", url: `https://bitharvest-qtyp.onrender.com/admin/dashboard?key=${ADMIN_ID}` }
                    ]]
                });
            }
        }
    } catch (err) {
        console.log("Webhook Processing Error:", err);
    }
});

app.get('/admin/dashboard', async (req, res) => {
    try {
        const adminKey = req.query.key;
        if (adminKey !== ADMIN_ID) {
            return res.status(403).send("<h1>403 Unauthorized Access!</h1>");
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
        let userTotalDeposit = 0;
        let userTotalWithdraw = 0;
        let totalRefEarn = 0;

        if (searchId) {
            searchedUser = await User.findOne({
                $or: [{ id: searchId }, { username: searchId.replace('@', '') }]
            });

            if (searchedUser) {
                if (searchedUser.deposits) {
                    searchedUser.deposits.forEach(d => {
                        if (d.status === 'PAID') userTotalDeposit += parseFloat(d.amount || 0);
                    });
                }
                if (searchedUser.withdrawals) {
                    searchedUser.withdrawals.forEach(w => {
                        if (w.status === 'PAID') userTotalWithdraw += parseFloat(w.amount || 0);
                    });
                }
                let l1Earn = searchedUser.refEarnings?.level1 || 0;
                let l2Earn = searchedUser.refEarnings?.level2 || 0;
                let l3Earn = searchedUser.refEarnings?.level3 || 0;
                totalRefEarn = l1Earn + l2Earn + l3Earn;
            }
        }

        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>BitHarvest Admin Panel</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
                    body { background: #09090b; color: #f4f4f5; margin: 0; padding: 20px; }
                    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #27272a; padding-bottom: 12px; }
                    .header h1 { color: #f59e0b; margin: 0; font-size: 22px; }
                    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 20px; }
                    .stat-card { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 12px; }
                    .stat-title { font-size: 10px; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.5px; }
                    .stat-value { font-size: 18px; font-weight: bold; color: #f59e0b; margin-top: 4px; }
                    .card { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
                    .card h3 { color: #f59e0b; margin-top: 0; font-size: 15px; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 12px; }
                    .search-box { display: flex; gap: 8px; }
                    input, textarea { background: #09090b; border: 1px solid #3f3f46; color: #fff; padding: 8px 12px; border-radius: 6px; width: 100%; font-size: 13px; outline: none; }
                    .btn { background: #f59e0b; color: #000; border: none; font-weight: 600; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
                    .btn-green { background: #22c55e; color: #fff; }
                    .btn-red { background: #ef4444; color: #fff; }
                    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
                    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #27272a; font-size: 12px; }
                    th { color: #a1a1aa; }
                    .user-box { background: #09090b; padding: 12px; border-radius: 6px; border: 1px solid #27272a; margin-top: 10px; font-size: 12px; line-height: 1.6; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>BitHarvest Admin</h1>
                    <span style="font-size: 11px; color: #22c55e; background: rgba(34,197,94,0.1); padding: 4px 8px; border-radius: 12px;">● Online</span>
                </div>

                <div class="stats-grid">
                    <div class="stat-card"><div class="stat-title">Total Users</div><div class="stat-value">${totalUsers}</div></div>
                    <div class="stat-card"><div class="stat-title">Total Balance</div><div class="stat-value">${totalBalances.toFixed(2)}</div></div>
                    <div class="stat-card"><div class="stat-title">Paid Out</div><div class="stat-value">${totalPaidOut.toFixed(2)}</div></div>
                    <div class="stat-card"><div class="stat-title">Pending Req</div><div class="stat-value">${requests.length}</div></div>
                </div>

                <div class="card">
                    <h3>Search User & Manage Balance</h3>
                    <form method="GET" action="/admin/dashboard" class="search-box">
                        <input type="hidden" name="key" value="${ADMIN_ID}">
                        <input type="text" name="search" placeholder="Enter Telegram ID or Username" value="${searchId}">
                        <button type="submit" class="btn">Search</button>
                    </form>

                    ${searchedUser ? `
                        <div class="user-box">
                            <p><b>User:</b> @${searchedUser.username} \vert{} <b>ID:</b> <code>${searchedUser.id}</code></p>
                            <p><b>Balance:</b> ${searchedUser.balance.toFixed(4)} USDT \vert{} <b>GHS:</b>${searchedUser.ghs}</p>
                            <p><b>Total Deposit:</b> ${userTotalDeposit.toFixed(2)} USDT \vert{} <b>Total Withdraw:</b>${userTotalWithdraw.toFixed(2)} USDT</p>
                            <p><b>Referrals:</b> L1: ${searchedUser.referrals?.level1?.length || 0} | L2: ${searchedUser.referrals?.level2?.length \vert{}\vert{} 0} \vert{} L3: ${searchedUser.referrals?.level3?.length || 0}</p>
                            <p><b>Ref Commission:</b> ${totalRefEarn.toFixed(4)} USDT</p>
                            <hr style="border-color:#27272a; margin:8px 0;">
                            <b>Quick Balance Adjust:</b>
                            <div style="display:flex; gap:8px; margin-top:6px;">
                                <input type="number" id="mod-amt" placeholder="Amount">
                                <button class="btn btn-green" onclick="modifyBal('${searchedUser.id}', 'add')">Add</button>
                                <button class="btn btn-red" onclick="modifyBal('${searchedUser.id}', 'cut')">Deduct</button>
                            </div>
                        </div>
                    ` : searchId ? `<p style="color:#ef4444; font-size:12px; margin-top:8px;">User not found!</p>` : ''}
                </div>

                <div class="card">
                    <h3>Pending Requests</h3>
                    ${requests.length === 0 ? `<p style="font-size:12px; color:#a1a1aa;">No pending requests found.</p>` : `
                        <table>
                            <tr><th>Type</th><th>User ID</th><th>Amount</th><th>Details</th><th>Action</th></tr>
                            ${requests.map(r => `
                                <tr>
                                    <td><b style="color:${r.type==='deposit'?'#22c55e':'#ef4444'}">${r.type.toUpperCase()}</b></td>
                                    <td><code>${r.userId}</code></td>
                                    <td><b>${r.amount} USDT</b></td>
                                    <td>${r.txHash ? 'Tx: ' + r.txHash.substring(0,8) + '...' : 'Addr: ' + (r.address ? r.address.substring(0,8) + '...' : 'N/A')}</td>
                                    <td>
                                        <button class="btn btn-green" style="padding:4px 8px; font-size:11px;" onclick="handleReq('${r.reqId}', 'approve')">Approve</button>
                                        <button class="btn btn-red" style="padding:4px 8px; font-size:11px;" onclick="handleReq('${r.reqId}', 'reject')">Reject</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </table>
                    `}
                </div>

                <div class="card">
                    <h3>Broadcast Message</h3>
                    <textarea id="bc-msg" rows="3" placeholder="Write message to send to all users..."></textarea>
                    <button class="btn" style="margin-top:8px; width:100%;" onclick="sendBroadcast()">Send Broadcast</button>
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
                        if(!amount) return alert("Please enter amount!");
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
    } catch (err) {
        res.status(500).send("Server Error: " + err.message);
    }
});

app.post('/admin/action', async (req, res) => {
    try {
        const { reqId, action, adminKey } = req.body;
        if (adminKey !== ADMIN_ID) return res.status(403).json({ success: false, message: "Unauthorized" });

        const reqDoc = await PendingRequest.findOne({ reqId });
        if (!reqDoc) return res.status(404).json({ success: false, message: "Request not found" });

        const u = await User.findOne({ id: reqDoc.userId });

        if (action === 'approve') {
            if (reqDoc.type === 'deposit' && u) {
                const depAmount = parseFloat(reqDoc.amount);
                u.ghs += depAmount;

                u.deposits = u.deposits.map(d => d.id === reqDoc.reqId ? { ...d, status: 'PAID' } : d);
                u.markModified('deposits');
                await u.save();

                if (u.referredBy) {
                    let refL1 = await User.findOne({ id: u.referredBy });
                    if (refL1) {
                        let commL1 = depAmount * 0.15;
                        refL1.balance += commL1;
                        refL1.refEarnings.level1 = (refL1.refEarnings.level1 || 0) + commL1;
                        await refL1.save();
                        sendTelegramMessage(refL1.id, `💰 Received +${commL1.toFixed(4)} USDT (15% Level 1 Referral Bonus)!`);

                        if (refL1.referredBy) {
                            let refL2 = await User.findOne({ id: refL1.referredBy });
                            if (refL2) {
                                let commL2 = depAmount * 0.02;
                                refL2.balance += commL2;
                                refL2.refEarnings.level2 = (refL2.refEarnings.level2 || 0) + commL2;
                                await refL2.save();
                                sendTelegramMessage(refL2.id, `💰 Received +${commL2.toFixed(4)} USDT (2% Level 2 Referral Bonus)!`);

                                if (refL2.referredBy) {
                                    let refL3 = await User.findOne({ id: refL2.referredBy });
                                    if (refL3) {
                                        let commL3 = depAmount * 0.01;
                                        refL3.balance += commL3;
                                        refL3.refEarnings.level3 = (refL3.refEarnings.level3 || 0) + commL3;
                                        await refL3.save();
                                        sendTelegramMessage(refL3.id, `💰 Received +${commL3.toFixed(4)} USDT (1% Level 3 Referral Bonus)!`);
                                    }
                                }
                            }
                        }
                    }
                }
                sendTelegramMessage(reqDoc.userId, `✅ Your deposit of ${reqDoc.amount} USDT has been APPROVED!`);
            } else if (reqDoc.type === 'withdraw' && u) {
                u.withdrawals = u.withdrawals.map(w => w.id === reqDoc.reqId ? { ...w, status: 'PAID' } : w);
                u.markModified('withdrawals');
                await u.save();
                sendTelegramMessage(reqDoc.userId, `✅ Your withdrawal of ${reqDoc.amount} USDT has been APPROVED and sent!`);
            }
        } else {
            if (reqDoc.type === 'deposit' && u) {
                u.deposits = u.deposits.map(d => d.id === reqDoc.reqId ? { ...d, status: 'DECLINED' } : d);
                u.markModified('deposits');
                await u.save();
                sendTelegramMessage(reqDoc.userId, `❌ Your deposit request of ${reqDoc.amount} USDT was DECLINED.`);
            } else if (reqDoc.type === 'withdraw' && u) {
                u.balance += parseFloat(reqDoc.amount);
                u.withdrawals = u.withdrawals.map(w => w.id === reqDoc.reqId ? { ...w, status: 'DECLINED' } : w);
                u.markModified('withdrawals');
                await u.save();
                sendTelegramMessage(reqDoc.userId, `❌ Your withdrawal request of ${reqDoc.amount} USDT was DECLINED and balance refunded.`);
            }
        }

        await PendingRequest.deleteOne({ reqId });
        res.json({ success: true, message: `Request successfully ${action}d!` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/admin/manage-balance', async (req, res) => {
    try {
        const { userId, amount, action, adminKey } = req.body;
        if (adminKey !== ADMIN_ID) return res.status(403).json({ success: false, message: "Unauthorized" });

        let u = await User.findOne({ id: userId });
        if (!u) return res.status(404).json({ success: false, message: "User not found!" });

        let amt = parseFloat(amount);
        if (action === 'add') {
            u.balance += amt;
            sendTelegramMessage(userId, `🎁 Admin added +${amt} USDT to your account balance!`);
        } else {
            u.balance = Math.max(0, u.balance - amt);
            sendTelegramMessage(userId, `⚠️ Admin deducted -${amt} USDT from your account balance.`);
        }
        await u.save();
        res.json({ success: true, message: `Successfully ${action}ed ${amt} USDT!` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/admin/broadcast', async (req, res) => {
    try {
        const { message, adminKey } = req.body;
        if (adminKey !== ADMIN_ID) return res.status(403).json({ success: false, message: "Unauthorized" });

        const users = await User.find({});
        for (let u of users) {
            await sendTelegramMessage(u.id, message);
        }
        res.json({ success: true, message: "Broadcast sent successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        let user = await User.findOne({ id: userId });
        if (!user) {
            user = new User({ id: userId, username: 'User' });
            await user.save();
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/claim', async (req, res) => {
    try {
        const { userId } = req.body;
        const u = await User.findOne({ id: userId });
        if (!u) return res.status(400).json({ success: false, message: "User not found" });

        let dailyProfit = u.ghs > 0 ? u.ghs * 0.3 : 0.01;
        let perSecondRate = dailyProfit / 86400;
        let elapsedSeconds = (Date.now() - u.lastClaimTime) / 1000;
        let minedAmount = Math.max(0, elapsedSeconds * perSecondRate);

        u.balance += minedAmount;
        u.lastClaimTime = Date.now();
        await u.save();

        res.json({ success: true, balance: u.balance, lastClaimTime: u.lastClaimTime });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/deposit', async (req, res) => {
    try {
        const { userId, username, amount, txHash } = req.body;
        let amt = parseFloat(amount);
        if (!userId || !amt || amt < 1 || amt > 1000) {
            return res.status(400).json({ success: false, message: "Invalid amount (Min 1 USDT)" });
        }

        let u = await User.findOne({ id: userId });
        if (!u) u = new User({ id: userId, username: username || 'User' });

        const reqId = 'dep_' + Date.now();
        u.deposits.unshift({ id: reqId, amount: amt, txHash, status: 'PENDING', date: new Date().toLocaleDateString() });
        u.markModified('deposits');
        await u.save();

        await PendingRequest.create({ reqId, type: 'deposit', userId, amount: amt, txHash });
        res.json({ success: true, message: "Deposit request submitted successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, username, amount, address } = req.body;
        let amt = parseFloat(amount);
        if (!userId || !amt || !address) return res.status(400).json({ success: false, message: "Missing data" });

        let u = await User.findOne({ id: userId });
        if (!u || u.balance < amt) {
            return res.status(400).json({ success: false, message: "Insufficient balance" });
        }

        u.balance -= amt;
        const reqId = 'wd_' + Date.now();
        u.withdrawals.unshift({ id: reqId, amount: amt, address, status: 'PENDING', date: new Date().toLocaleDateString() });
        u.markModified('withdrawals');
        await u.save();

        await PendingRequest.create({ reqId, type: 'withdraw', userId, amount: amt, address });
        res.json({ success: true, message: "Withdrawal request submitted successfully" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running smoothly on port ${PORT}`);
    try {
        const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
        if (RENDER_URL && BOT_TOKEN && typeof fetch !== 'undefined') {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${RENDER_URL}/api/webhook/${BOT_TOKEN}`);
            console.log("Telegram Webhook verified successfully.");
        }
    } catch (e) {
        console.log("Webhook initialization info:", e.message);
    }
});
