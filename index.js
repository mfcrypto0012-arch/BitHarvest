const express = require('express');
const mongoose = require('mongoose');
const https = require('https');
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

// Native HTTPS Telegram Sender (No crash risk)
function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (!BOT_TOKEN) return;
    const payload = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, (res) => {});
    req.on('error', (e) => console.error('TG Send Error:', e));
    req.write(payload);
    req.end();
}

function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
    if (!BOT_TOKEN) return;
    const payload = JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/editMessageText`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, (res) => {});
    req.on('error', (e) => console.error('TG Edit Error:', e));
    req.write(payload);
    req.end();
}

function answerCallbackQuery(callbackQueryId, text) {
    if (!BOT_TOKEN) return;
    const payload = JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/answerCallbackQuery`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, (res) => {});
    req.on('error', (e) => console.error('TG Callback Error:', e));
    req.write(payload);
    req.end();
}

app.get('/api/user/:id', async (req, res) => {
    try {
        let user = await User.findOne({ id: req.params.id });
        if (!user) {
            user = new User({ id: req.params.id, username: 'User' });
            await user.save();
        }
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: "Server error" });
    }
});

app.post('/api/claim', async (req, res) => {
    try {
        const { userId } = req.body;
        let user = await User.findOne({ id: userId });
        if (!user) return res.json({ success: false });

        let dailyProfit = user.ghs > 0 ? user.ghs * 0.3 : 0.01;
        let perSecondRate = dailyProfit / 86400;
        let elapsedSeconds = (Date.now() - user.lastClaimTime) / 1000;
        let earned = elapsedSeconds * perSecondRate;

        user.balance += earned;
        user.lastClaimTime = Date.now();
        await user.save();

        res.json({ success: true, balance: user.balance, lastClaimTime: user.lastClaimTime });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/deposit', async (req, res) => {
    try {
        const { userId, username, amount, txHash } = req.body;
        let user = await User.findOne({ id: userId });
        if (!user) return res.json({ success: false });

        let reqId = 'dep_' + Date.now();
        let depObj = {
            id: reqId,
            amount: parseFloat(amount),
            txHash: txHash,
            status: 'PENDING',
            date: new Date().toLocaleDateString()
        };

        user.deposits.push(depObj);
        user.markModified('deposits');
        await user.save();

        let newReq = new PendingRequest({
            reqId: reqId,
            type: 'deposit',
            userId: userId,
            amount: parseFloat(amount),
            txHash: txHash
        });
        await newReq.save();

        sendTelegramMessage(ADMIN_ID, `📥 *New Deposit Request*\n\nUser: @${username} (\`${userId}\`)\nAmount: \`${amount} USDT\`\nTxHash: \`${txHash}\``, {
            inline_keyboard: [
                [
                    { text: "✅ Approve", callback_data: `approve_${reqId}` },
                    { text: "❌ Reject", callback_data: `reject_${reqId}` }
                ]
            ]
        });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, username, amount, address } = req.body;
        let user = await User.findOne({ id: userId });
        if (!user) return res.json({ success: false, message: "User not found" });

        if (user.balance < parseFloat(amount)) {
            return res.json({ success: false, message: "Insufficient balance!" });
        }

        let reqId = 'wth_' + Date.now();
        let wthObj = {
            id: reqId,
            amount: parseFloat(amount),
            address: address,
            status: 'PENDING',
            date: new Date().toLocaleDateString()
        };

        user.withdrawals.push(wthObj);
        user.markModified('withdrawals');
        await user.save();

        let newReq = new PendingRequest({
            reqId: reqId,
            type: 'withdraw',
            userId: userId,
            amount: parseFloat(amount),
            address: address
        });
        await newReq.save();

        sendTelegramMessage(ADMIN_ID, `📤 *New Withdrawal Request*\n\nUser: @${username} (\`${userId}\`)\nAmount: \`${amount} USDT\`\nAddress: \`${address}\``, {
            inline_keyboard: [
                [
                    { text: "✅ Approve", callback_data: `approve_${reqId}` },
                    { text: "❌ Reject", callback_data: `reject_${reqId}` }
                ]
            ]
        });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

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
                const referrerId = parts[1] ? String(parts[1]).trim() : null;

                let user = await User.findOne({ id: chatId });

                if (!user) {
                    user = new User({
                        id: chatId,
                        username: msg.from.username || msg.from.first_name || 'User',
                        referredBy: (referrerId && referrerId !== chatId) ? referrerId : null
                    });

                    if (referrerId && referrerId !== chatId) {
                        const refL1 = await User.findOne({ id: referrerId });
                        if (refL1) {
                            if (!refL1.referrals.level1.includes(chatId)) {
                                refL1.referrals.level1.push(chatId);
                                refL1.markModified('referrals');
                                await refL1.save();
                                sendTelegramMessage(referrerId, `🎉 *New Level 1 Referral Joined!*\nUser ID: \`${chatId}\``);
                            }

                            if (refL1.referredBy) {
                                const refL2 = await User.findOne({ id: refL1.referredBy });
                                if (refL2) {
                                    if (!refL2.referrals.level2.includes(chatId)) {
                                        refL2.referrals.level2.push(chatId);
                                        refL2.markModified('referrals');
                                        await refL2.save();
                                    }

                                    if (refL2.referredBy) {
                                        const refL3 = await User.findOne({ id: refL2.referredBy });
                                        if (refL3) {
                                            if (!refL3.referrals.level3.includes(chatId)) {
                                                refL3.referrals.level3.push(chatId);
                                                refL3.markModified('referrals');
                                                await refL3.save();
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    await user.save();
                }

                sendTelegramMessage(chatId, "🚀 *Welcome to BitHarvest USDT Mining Mini App!*\n\nClick the WebApp button below to launch.");
            } else if (text === '/admin' && chatId === String(ADMIN_ID)) {
                sendTelegramMessage(chatId, `👑 *BitHarvest Admin Access*\n\nClick below to open Admin Dashboard:`, {
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
                const reqDoc = await PendingRequest.findOne({ reqId });

                if (!reqDoc) return answerCallbackQuery(query.id, "Request already handled!");

                const u = await User.findOne({ id: reqDoc.userId });

                if (isApprove) {
                    if (reqDoc.type === 'deposit' && u) {
                        const depAmount = parseFloat(reqDoc.amount);
                        u.ghs += depAmount;
                        
                        let idx = u.deposits.findIndex(d => d.id === reqId || d.id === reqDoc.reqId);
                        if (idx !== -1) {
                            u.deposits[idx].status = 'PAID';
                        } else {
                            let p = u.deposits.find(d => d.status === 'PENDING');
                            if (p) p.status = 'PAID';
                        }
                        u.markModified('deposits');
                        await u.save();

                        if (u.referredBy) {
                            let refL1 = await User.findOne({ id: u.referredBy });
                            if (refL1) {
                                let commL1 = depAmount * 0.15;
                                refL1.balance += commL1;
                                refL1.refEarnings.level1 = (refL1.refEarnings.level1 || 0) + commL1;
                                refL1.markModified('refEarnings');
                                await refL1.save();
                                sendTelegramMessage(refL1.id, `🎁 Received +${commL1.toFixed(4)} USDT (15% Level 1 Referral Commission)!`);

                                if (refL1.referredBy) {
                                    let refL2 = await User.findOne({ id: refL1.referredBy });
                                    if (refL2) {
                                        let commL2 = depAmount * 0.02;
                                        refL2.balance += commL2;
                                        refL2.refEarnings.level2 = (refL2.refEarnings.level2 || 0) + commL2;
                                        refL2.markModified('refEarnings');
                                        await refL2.save();
                                        sendTelegramMessage(refL2.id, `🎁 Received +${commL2.toFixed(4)} USDT (2% Level 2 Referral Commission)!`);

                                        if (refL2.referredBy) {
                                            let refL3 = await User.findOne({ id: refL2.referredBy });
                                            if (refL3) {
                                                let commL3 = depAmount * 0.01;
                                                refL3.balance += commL3;
                                                refL3.refEarnings.level3 = (refL3.refEarnings.level3 || 0) + commL3;
                                                refL3.markModified('refEarnings');
                                                await refL3.save();
                                                sendTelegramMessage(refL3.id, `🎁 Received +${commL3.toFixed(4)} USDT (1% Level 3 Referral Commission)!`);
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        sendTelegramMessage(reqDoc.userId, `✅ Your deposit of ${reqDoc.amount} USDT has been approved!`);
                    } else if (reqDoc.type === 'withdraw' && u) {
                        u.balance -= parseFloat(reqDoc.amount);
                        let idx = u.withdrawals.findIndex(w => w.id === reqId || w.id === reqDoc.reqId);
                        if (idx !== -1) {
                            u.withdrawals[idx].status = 'PAID';
                        } else {
                            let p = u.withdrawals.find(w => w.status === 'PENDING' || w.status === 'PEND1NG');
                            if (p) p.status = 'PAID';
                        }
                        u.markModified('withdrawals');
                        await u.save();
                        sendTelegramMessage(reqDoc.userId, `✅ Your withdrawal of ${reqDoc.amount} USDT has been approved!`);
                    }
                    editTelegramMessage(chatId, messageId, `✅ *Request Approved*\nUser ID: ${reqDoc.userId}\nAmount: ${reqDoc.amount} USDT`);
                } else {
                    if (reqDoc.type === 'deposit' && u) {
                        let idx = u.deposits.findIndex(d => d.id === reqId || d.id === reqDoc.reqId);
                        if (idx !== -1) {
                            u.deposits[idx].status = 'DECLINED';
                        } else {
                            let p = u.deposits.find(d => d.status === 'PENDING');
                            if (p) p.status = 'DECLINED';
                        }
                        u.markModified('deposits');
                        await u.save();
                        sendTelegramMessage(reqDoc.userId, `❌ Your deposit request was declined.`);
                    } else if (reqDoc.type === 'withdraw' && u) {
                        let idx = u.withdrawals.findIndex(w => w.id === reqId || w.id === reqDoc.reqId);
                        if (idx !== -1) {
                            u.withdrawals[idx].status = 'DECLINED';
                        } else {
                            let p = u.withdrawals.find(w => w.status === 'PENDING' || w.status === 'PEND1NG');
                            if (p) p.status = 'DECLINED';
                        }
                        u.markModified('withdrawals');
                        await u.save();
                        sendTelegramMessage(reqDoc.userId, `❌ Your withdrawal request was declined.`);
                    }
                    editTelegramMessage(chatId, messageId, `❌ *Request Rejected*\nUser ID: ${reqDoc.userId}\nAmount: ${reqDoc.amount} USDT`);
                }

                await PendingRequest.deleteOne({ reqId });
                answerCallbackQuery(query.id, "Done!");
            }
        }
    } catch (err) {
        console.log("Webhook error:", err);
    }
});

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

    let html = `<!DOCTYPE html>
<html>
<head>
    <title>BitHarvest Admin Panel</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; font-family: sans-serif; }
        body { background: #0c0a09; color: #f3f4f6; margin: 0; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .header h1 { color: #f59e0b; margin: 0; font-size: 22px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 20px; }
        .stat-card { background: #1c1917; border: 1px solid #292524; border-radius: 8px; padding: 12px; }
        .stat-title { font-size: 11px; color: #a8a29e; }
        .stat-value { font-size: 18px; font-weight: bold; color: #fbbf24; margin-top: 4px; }
        .card { background: #1c1917; border: 1px solid #292524; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
        .search-box { display: flex; gap: 8px; margin-bottom: 12px; }
        input { background: #0c0a09; border: 1px solid #44403c; color: #fff; padding: 8px; border-radius: 6px; width: 100%; }
        .btn { background: #f59e0b; color: #000; border: none; font-weight: bold; padding: 8px 14px; border-radius: 6px; cursor: pointer; }
        .btn-green { background: #22c55e; color: #fff; }
        .btn-red { background: #ef4444; color: #fff; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #292524; }
    </style>
</head>
<body>
    <div class="header">
        <h1>👑 BitHarvest Admin</h1>
        <span style="color:#22c55e; font-size:12px;">● Live</span>
    </div>
    <div class="stats-grid">
        <div class="stat-card"><div class="stat-title">Total Users</div><div class="stat-value">${totalUsers}</div></div>
        <div class="stat-card"><div class="stat-title">User Balances</div><div class="stat-value">${totalBalances.toFixed(2)} USDT</div></div>
        <div class="stat-card"><div class="stat-title">Paid Out</div><div class="stat-value">${totalPaidOut.toFixed(2)} USDT</div></div>
        <div class="stat-card"><div class="stat-title">Pending</div><div class="stat-value">${requests.length}</div></div>
    </div>
    <div class="card">
        <h3>🔍 Search User</h3>
        <form method="GET" action="/admin/dashboard" class="search-box">
            <input type="hidden" name="key" value="${ADMIN_ID}">
            <input type="text" name="search" placeholder="User ID or Username" value="${searchId}">
            <button type="submit" class="btn">Search</button>
        </form>
        ${searchedUser ? `
            <div style="font-size:13px; line-height:1.6;">
                <p>👤 <b>User:</b> @${searchedUser.username} \vert{} <b>ID:</b>${searchedUser.id}</p>
                <p>💰 <b>Balance:</b> ${searchedUser.balance.toFixed(4)} USDT \vert{} ⚡ <b>GHS:</b>${searchedUser.ghs}</p>
                <p>📥 <b>Deposits:</b> ${userTotalDeposit.toFixed(2)} USDT \vert{} 📤 <b>Withdraws:</b> ${userTotalWithdraw.toFixed(2)} USDT</p>
                <p>👥 <b>Ref Counts:</b> L1: ${searchedUser.referrals?.level1?.length || 0} | L2: ${searchedUser.referrals?.level2?.length \vert{}\vert{} 0} \vert{} L3: ${searchedUser.referrals?.level3?.length || 0}</p>
                <p>🔗 <b>Referred By:</b> ${searchedUser.referredBy || 'Direct Join'}</p>
            </div>
        ` : ''}
    </div>
    <div class="card">
        <h3>⏳ Pending Requests</h3>
        ${requests.length === 0 ? '<p style="font-size:12px;">No requests.</p>' : `
            <table>
                <tr><th>Type</th><th>User</th><th>Amount</th><th>Action</th></tr>
                ${requests.map(r => `
                    <tr>
                        <td><b>${r.type.toUpperCase()}</b></td>
                        <td>${r.userId}</td>
                        <td>${r.amount} USDT</td>
                        <td>
                            <button class="btn btn-green" onclick="handleReq('${r.reqId}', 'approve')">Approve</button>
                            <button class="btn btn-red" onclick="handleReq('${r.reqId}', 'reject')">Reject</button>
                        </td>
                    </tr>
                `).join('')}
            </table>
        `}
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
    </script>
</body>
</html>`;
    res.send(html);
});

app.post('/admin/action', async (req, res) => {
    const { reqId, action, adminKey } = req.body;
    if (adminKey !== ADMIN_ID) return res.status(403).json({ success: false, message: "Unauthorized" });

    const reqDoc = await PendingRequest.findOne({ reqId });
    if (!reqDoc) return res.status(404).json({ success: false, message: "Request not found" });

    const u = await User.findOne({ id: reqDoc.userId });

    if (action === 'approve') {
        if (reqDoc.type === 'deposit' && u) {
            const depAmount = parseFloat(reqDoc.amount);
            u.ghs += depAmount;
            
            let idx = u.deposits.findIndex(d => d.id === reqId || d.id === reqDoc.reqId);
            if (idx !== -1) {
                u.deposits[idx].status = 'PAID';
            } else {
                let p = u.deposits.find(d => d.status === 'PENDING');
                if (p) p.status = 'PAID';
            }
            u.markModified('deposits');
            await u.save();

            sendTelegramMessage(reqDoc.userId, `✅ Your deposit of ${reqDoc.amount} USDT has been approved!`);
        } else if (reqDoc.type === 'withdraw' && u) {
            u.balance -= parseFloat(reqDoc.amount);
            let idx = u.withdrawals.findIndex(w => w.id === reqId || w.id === reqDoc.reqId);
            if (idx !== -1) {
                u.withdrawals[idx].status = 'PAID';
            } else {
                let p = u.withdrawals.find(w => w.status === 'PENDING' || w.status === 'PEND1NG');
                if (p) p.status = 'PAID';
            }
            u.markModified('withdrawals');
            await u.save();
            sendTelegramMessage(reqDoc.userId, `✅ Your withdrawal of ${reqDoc.amount} USDT has been approved!`);
        }
    }

    await PendingRequest.deleteOne({ reqId });
    res.json({ success: true, message: "Action executed successfully!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
