const express = require('express');
const mongoose = require('mongoose');

const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

// ==================== DATABASE SCHEMAS ====================

const userSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    username: { type: String, default: 'User' },
    balance: { type: Number, default: 0, min: 0 },
    ghs: { type: Number, default: 0, min: 0 },
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
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);

const pendingRequestSchema = new mongoose.Schema({
    reqId: { type: String, required: true, unique: true },
    type: { type: String, required: true, enum: ['deposit', 'withdraw'] },
    userId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    txHash: String,
    address: String,
    status: { type: String, default: 'PENDING' }
}, { timestamps: true });

const PendingRequest = mongoose.models.PendingRequest || mongoose.model('PendingRequest', pendingRequestSchema);

// ==================== HELPER FUNCTIONS ====================

function validAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 100000000 ? n : null;
}

async function sendTelegramMessage(chatId, message, replyMarkup = null) {
    if (!BOT_TOKEN || !chatId) return;

    try {
        const body = { chat_id: chatId, text: message, parse_mode: 'Markdown' };
        if (replyMarkup) body.reply_markup = replyMarkup;

        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    } catch (err) {
        console.error('Telegram send error:', err.message);
    }
}

async function editTelegramMessage(chatId, messageId, message) {
    if (!BOT_TOKEN) return;

    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: message, parse_mode: 'Markdown' })
        });
    } catch (err) {
        console.error('Telegram edit error:', err.message);
    }
}

async function answerCallbackQuery(callbackQueryId, message) {
    if (!BOT_TOKEN) return;

    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackQueryId, text: message })
        });
    } catch (err) {
        console.error('Callback error:', err.message);
    }
}

async function notifyAdmin(message, keyboard) {
    if (!ADMIN_ID) return;
    await sendTelegramMessage(ADMIN_ID, message, keyboard);
}

function adminAuthorized(req) {
    const key = req.body?.adminKey || req.query?.key;
    return Boolean(ADMIN_ID && key && key === ADMIN_ID);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

// ==================== REFERRALS LOGIC (CODE 2 PERFECT) ====================

async function processReferral(chatId, referrerId) {
    chatId = String(chatId);
    referrerId = String(referrerId || '').trim();

    if (!referrerId || !/^\d+$/.test(referrerId)) return;
    if (chatId === referrerId) return;

    const refL1 = await User.findOne({ id: referrerId });
    if (!refL1) return;

    const user = await User.findOne({ id: chatId });
    if (!user) return;

    if (!user.referredBy) {
        user.referredBy = refL1.id;
        await user.save();
    }

    // Level 1 Tracking
    if (!refL1.referrals.level1.includes(chatId)) {
        refL1.referrals.level1.push(chatId);
        refL1.markModified('referrals');
        await refL1.save();
        sendTelegramMessage(referrerId, `🎉 *New Level 1 Referral Joined!*\nUser ID: \`${chatId}\``);
    }

    // Level 2 Tracking
    if (refL1.referredBy && refL1.referredBy !== chatId) {
        const refL2 = await User.findOne({ id: refL1.referredBy });
        if (refL2) {
            if (!refL2.referrals.level2.includes(chatId)) {
                refL2.referrals.level2.push(chatId);
                refL2.markModified('referrals');
                await refL2.save();
            }

            // Level 3 Tracking
            if (refL2.referredBy && refL2.referredBy !== chatId) {
                const refL3 = await User.findOne({ id: refL2.referredBy });
                if (refL3 && refL3.id !== chatId) {
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

// ==================== REFERRAL COMMISSION (CODE 2 EXACT) ====================

async function payReferralCommissions(user, amount) {
    if (!user.referredBy) return;

    const commissions = [
        { rate: 0.15, level: 'level1', label: '15% Level 1' },
        { rate: 0.02, level: 'level2', label: '2% Level 2' },
        { rate: 0.01, level: 'level3', label: '1% Level 3' }
    ];

    let currentReferrerId = user.referredBy;

    for (const item of commissions) {
        if (!currentReferrerId || currentReferrerId === user.id) break;

        const referrer = await User.findOne({ id: currentReferrerId });
        if (!referrer) break;

        const commission = amount * item.rate;

        referrer.balance += commission;
        referrer.refEarnings[item.level] = (referrer.refEarnings[item.level] || 0) + commission;

        referrer.markModified('refEarnings');
        await referrer.save();

        await sendTelegramMessage(
            referrer.id,
            `🎁 Received +${commission.toFixed(4)} USDT (${item.label} Referral Commission)!`
        );

        currentReferrerId = referrer.referredBy;
    }
}

// ==================== USER API ====================

app.get('/api/user/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        if (!/^\d{1,25}$/.test(id)) return res.status(400).json({ error: 'Invalid user ID' });

        let user = await User.findOne({ id });
        if (!user) user = await User.create({ id });

        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/claim', async (req, res) => {
    try {
        const userId = String(req.body.userId || '');
        if (!userId) return res.status(400).json({ success: false });

        const user = await User.findOne({ id: userId });
        if (!user) return res.status(404).json({ success: false });

        const now = Date.now();
        const last = Number(user.lastClaimTime) || now;
        const elapsed = Math.max(0, (now - last) / 1000);
        const dailyProfit = user.ghs > 0 ? user.ghs * 0.3 : 0.01;
        const earned = elapsed * dailyProfit / 86400;

        user.balance += earned;
        user.lastClaimTime = now;
        await user.save();

        res.json({ success: true, balance: user.balance, ghs: user.ghs, lastClaimTime: user.lastClaimTime });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ==================== DEPOSIT & WITHDRAW REQUESTS ====================

app.post('/api/deposit', async (req, res) => {
    try {
        const userId = String(req.body.userId || '');
        const username = String(req.body.username || 'User');
        const amount = validAmount(req.body.amount);
        const txHash = String(req.body.txHash || '').trim();

        if (!userId || !amount || !txHash) return res.status(400).json({ success: false, message: 'Invalid details' });

        const user = await User.findOne({ id: userId });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const reqId = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await PendingRequest.create({ reqId, type: 'deposit', userId, amount, txHash });

        user.deposits.push({ id: reqId, amount, txHash, status: 'PENDING', date: new Date().toLocaleDateString() });
        user.markModified('deposits');
        await user.save();

        await notifyAdmin(`📥 *New Deposit Request*\n\nUser: @${username} (\`${userId}\`)\nAmount: \`${amount} USDT\`\nTxHash: \`${txHash}\``, {
            inline_keyboard: [[{ text: '✅ Approve', callback_data: `approve_${reqId}` }, { text: '❌ Reject', callback_data: `reject_${reqId}` }]]
        });

        res.json({ success: true, reqId });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const userId = String(req.body.userId || '');
        const username = String(req.body.username || 'User');
        const address = String(req.body.address || '').trim();
        const amount = validAmount(req.body.amount);

        if (!userId || !amount || !address) return res.status(400).json({ success: false, message: 'Invalid details' });

        const user = await User.findOne({ id: userId });
        if (!user || user.balance < amount) return res.status(400).json({ success: false, message: 'Insufficient balance!' });

        const reqId = `wth_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await PendingRequest.create({ reqId, type: 'withdraw', userId, amount, address });

        user.withdrawals.push({ id: reqId, amount, address, status: 'PENDING', date: new Date().toLocaleDateString() });
        user.markModified('withdrawals');
        await user.save();

        await notifyAdmin(`📤 *New Withdrawal Request*\n\nUser: @${username} (\`${userId}\`)\nAmount: \`${amount} USDT\`\nAddress: \`${address}\``, {
            inline_keyboard: [[{ text: '✅ Approve', callback_data: `approve_${reqId}` }, { text: '❌ Reject', callback_data: `reject_${reqId}` }]]
        });

        res.json({ success: true, reqId });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ==================== PROCESS DEPOSIT/WITHDRAW (CODE 2 PERFECT) ====================

async function processRequest(reqId, action) {
    const request = await PendingRequest.findOneAndUpdate({ reqId, status: 'PENDING' }, { $set: { status: 'PROCESSING' } }, { new: true });
    if (!request) return { success: false, message: 'Request not found or already handled' };

    try {
        const user = await User.findOne({ id: request.userId });
        if (!user) return { success: false, message: 'User not found' };

        if (action === 'approve') {
            if (request.type === 'deposit') {
                let deposit = user.deposits.find(d => d.id === reqId);
                if (deposit) deposit.status = 'PAID';
                else {
                    let p = user.deposits.find(d => d.status === 'PENDING');
                    if (p) p.status = 'PAID';
                }

                user.ghs += Number(request.amount);
                user.markModified('deposits');
                await user.save();

                await payReferralCommissions(user, Number(request.amount));
                await sendTelegramMessage(user.id, `✅ Your deposit of ${request.amount} USDT has been approved!`);
            } else if (request.type === 'withdraw') {
                let withdrawal = user.withdrawals.find(w => w.id === reqId);
                if (withdrawal) withdrawal.status = 'PAID';
                else {
                    let p = user.withdrawals.find(w => w.status === 'PENDING');
                    if (p) p.status = 'PAID';
                }

                user.balance = Math.max(0, user.balance - Number(request.amount));
                user.markModified('withdrawals');
                await user.save();

                await sendTelegramMessage(user.id, `✅ Your withdrawal of ${request.amount} USDT has been approved!`);
            }
        } else {
            if (request.type === 'deposit') {
                let deposit = user.deposits.find(d => d.id === reqId);
                if (deposit) deposit.status = 'DECLINED';
                user.markModified('deposits');
                await user.save();
                await sendTelegramMessage(user.id, '❌ Your deposit request was declined.');
            } else if (request.type === 'withdraw') {
                let withdrawal = user.withdrawals.find(w => w.id === reqId);
                if (withdrawal) withdrawal.status = 'DECLINED';
                user.markModified('withdrawals');
                await user.save();
                await sendTelegramMessage(user.id, '❌ Your withdrawal request was declined.');
            }
        }

        await PendingRequest.deleteOne({ reqId });
        return { success: true, message: action === 'approve' ? 'Request approved successfully!' : 'Request rejected successfully!' };
    } catch (err) {
        await PendingRequest.updateOne({ reqId, status: 'PROCESSING' }, { $set: { status: 'PENDING' } });
        return { success: false, message: err.message };
    }
}

// ==================== TELEGRAM WEBHOOK ====================

if (BOT_TOKEN) {
    app.post(`/api/webhook/${BOT_TOKEN}`, async (req, res) => {
        res.sendStatus(200);

        try {
            const update = req.body;
            if (update.message) {
                const msg = update.message;
                const chatId = String(msg.chat.id);
                const text = msg.text || '';

                if (text.startsWith('/start')) {
                    const parts = text.trim().split(/\s+/);
                    const referrerId = parts.length > 1 ? parts[1] : null;

                    let user = await User.findOne({ id: chatId });
                    if (!user) {
                        user = await User.create({
                            id: chatId,
                            username: msg.from.username || msg.from.first_name || 'User'
                        });
                    }

                    if (referrerId) {
                        await processReferral(chatId, referrerId);
                    }

                    await sendTelegramMessage(chatId, '🚀 *Welcome to BitHarvest USDT Mining Mini App!*\n\nClick the WebApp button below to launch.');
                }

                if (text === '/admin' && chatId === ADMIN_ID) {
                    await sendTelegramMessage(chatId, '👑 *BitHarvest Admin Access*\n\nClick below to open Admin Dashboard:', {
                        inline_keyboard: [[{ text: '🌐 Open Admin Dashboard', url: `https://bitharvest-qtyp.onrender.com/admin/dashboard?key=${encodeURIComponent(ADMIN_ID)}` }]]
                    });
                }
            }

            if (update.callback_query) {
                const query = update.callback_query;
                const chatId = String(query.message?.chat?.id || '');
                const data = query.data || '';

                if (chatId !== ADMIN_ID) return answerCallbackQuery(query.id, 'Unauthorized!');

                if (data.startsWith('approve_') || data.startsWith('reject_')) {
                    const isApprove = data.startsWith('approve_');
                    const reqId = data.replace(isApprove ? 'approve_' : 'reject_', '');

                    const result = await processRequest(reqId, isApprove ? 'approve' : 'reject');
                    if (result.success) {
                        await editTelegramMessage(chatId, query.message.message_id, `${isApprove ? '✅ Request Approved' : '❌ Request Rejected'}`);
                    }
                    await answerCallbackQuery(query.id, result.message);
                }
            }
        } catch (err) {
            console.error('Webhook error:', err);
        }
    });
}

// ==================== ADMIN DASHBOARD ====================

app.get('/admin/dashboard', async (req, res) => {
    if (!adminAuthorized(req)) return res.status(403).send('Unauthorized Access');

    try {
        const totalUsers = await User.countDocuments();
        const users = await User.find().lean();
        const requests = await PendingRequest.find({ status: 'PENDING' }).lean();

        const totalBalances = users.reduce((sum, u) => sum + (u.balance || 0), 0);
        let totalPaidOut = 0;
        users.forEach(u => {
            (u.withdrawals || []).forEach(w => {
                if (w.status === 'PAID') totalPaidOut += Number(w.amount || 0);
            });
        });

        const search = String(req.query.search || '').trim();
        let searchedUser = null;

        if (search) {
            searchedUser = await User.findOne({ $or: [{ id: search }, { username: search.replace(/^@/, '') }] }).lean();
        }

        let userDetails = '';
        if (searchedUser) {
            const u = searchedUser;
            const ref = u.referrals || {};
            const earn = u.refEarnings || {};
            const totalRefEarn = (earn.level1 || 0) + (earn.level2 || 0) + (earn.level3 || 0);

            userDetails = `
                <div class="user-details-box">
                    <p>👤 <b>User Name:</b> @${escapeHtml(u.username)} | <b>ID:</b> <code>${escapeHtml(u.id)}</code></p>
                    <p>💰 <b>Current Balance:</b> <span style="color:#fbbf24;font-weight:bold;">${Number(u.balance || 0).toFixed(4)} USDT</span> | ⚡ <b>GHS Power:</b> ${u.ghs} GHS</p>
                    <p>👥 <b>Referrals Count:</b> L1: ${ref.level1?.length || 0} | L2: ${ref.level2?.length || 0} | L3: ${ref.level3?.length || 0}</p>
                    <p>🎁 <b>Total Referral Commission:</b> <span style="color:#fbbf24;font-weight:bold;">${totalRefEarn.toFixed(4)} USDT</span></p>
                    <p>🔗 <b>Referred By ID:</b> ${u.referredBy || 'Direct Join'}</p>
                    <hr style="border-color:#292524;margin:12px 0;">
                    <b>⚙️ Manage User Balance:</b>
                    <div style="display:flex;gap:10px;margin-top:8px;">
                        <input type="number" id="mod-amt" placeholder="Enter USDT amount" min="0.0001" step="any">
                        <button class="btn btn-green" onclick="modifyBal('${u.id}', 'add')">+ Add</button>
                        <button class="btn btn-red" onclick="modifyBal('${u.id}', 'cut')">- Cut</button>
                    </div>
                </div>
            `;
        }

        res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>BitHarvest Admin Panel</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
        body { background: #0c0a09; color: #f3f4f6; margin: 0; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .header h1 { color: #f59e0b; margin: 0; font-size: 24px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 25px; }
        .stat-card { background: #1c1917; border: 1px solid #292524; border-radius: 12px; padding: 15px; }
        .stat-title { font-size: 11px; color: #a8a29e; text-transform: uppercase; }
        .stat-value { font-size: 20px; font-weight: bold; color: #fbbf24; margin-top: 6px; }
        .card { background: #1c1917; border: 1px solid #292524; border-radius: 12px; padding: 18px; margin-bottom: 20px; }
        .card h3 { color: #f59e0b; margin-top: 0; font-size: 16px; border-bottom: 1px solid #292524; padding-bottom: 8px; }
        .search-box { display: flex; gap: 10px; margin-bottom: 15px; }
        input { background: #0c0a09; border: 1px solid #44403c; color: #fff; padding: 10px; border-radius: 8px; width: 100%; font-size: 14px; }
        .btn { background: #f59e0b; color: #000; border: none; font-weight: bold; padding: 10px 18px; border-radius: 8px; cursor: pointer; }
        .btn-green { background: #22c55e; color: #fff; }
        .btn-red { background: #ef4444; color: #fff; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #292524; font-size: 12px; }
        th { color: #a8a29e; }
        .user-details-box { background: #0c0a09; padding: 14px; border-radius: 8px; border: 1px solid #292524; margin-top: 10px; font-size: 13px; line-height: 1.8; }
    </style>
</head>
<body>
    <div class="header">
        <h1>👑 BitHarvest Admin Panel</h1>
        <span style="font-size:12px;color:#22c55e;">● Live System</span>
    </div>

    <div class="stats-grid">
        <div class="stat-card"><div class="stat-title">Total Users</div><div class="stat-value">${totalUsers}</div></div>
        <div class="stat-card"><div class="stat-title">User Balances</div><div class="stat-value">${totalBalances.toFixed(2)} USDT</div></div>
        <div class="stat-card"><div class="stat-title">Paid Out</div><div class="stat-value">${totalPaidOut.toFixed(2)} USDT</div></div>
        <div class="stat-card"><div class="stat-title">Pending Requests</div><div class="stat-value">${requests.length}</div></div>
    </div>

    <div class="card">
        <h3>🔍 Search User Details & Manage Balance</h3>
        <form method="GET" action="/admin/dashboard" class="search-box">
            <input type="hidden" name="key" value="${escapeHtml(ADMIN_ID)}">
            <input type="text" name="search" placeholder="Enter Telegram User ID or Username" value="${escapeHtml(search)}">
            <button type="submit" class="btn">Search</button>
        </form>
        ${userDetails}
    </div>

    <div class="card">
        <h3>⏳ Pending Requests</h3>
        ${requests.length === 0 ? '<p style="font-size:12px;color:#a8a29e;">No pending requests right now.</p>' : `
            <table>
                <tr><th>Type</th><th>User ID</th><th>Amount</th><th>Details</th><th>Action</th></tr>
                ${requests.map(r => `
                    <tr>
                        <td><b style="color:${r.type === 'deposit' ? '#22c55e' : '#ef4444'}">${r.type.toUpperCase()}</b></td>
                        <td>${r.userId}</td>
                        <td><b>${r.amount} USDT</b></td>
                        <td>${r.txHash ? 'Tx: ' + r.txHash.substring(0, 10) + '...' : 'Addr: ' + String(r.address || '').substring(0, 10) + '...'}</td>
                        <td>
                            <button class="btn btn-green" style="padding:4px 8px;font-size:11px;" onclick="handleReq('${r.reqId}', 'approve')">Approve</button>
                            <button class="btn btn-red" style="padding:4px 8px;font-size:11px;" onclick="handleReq('${r.reqId}', 'reject')">Reject</button>
                        </td>
                    </tr>
                `).join('')}
            </table>
        `}
    </div>

    <script>
        async function handleReq(reqId, action) {
            const res = await fetch('/admin/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reqId, action, adminKey: ${JSON.stringify(ADMIN_ID)} })
            });
            const data = await res.json();
            alert(data.message);
            if (data.success) location.reload();
        }

        async function modifyBal(userId, action) {
            const amount = document.getElementById('mod-amt').value;
            if (!amount || Number(amount) <= 0) return alert('Enter a valid amount!');
            const res = await fetch('/admin/manage-balance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, amount, action, adminKey: ${JSON.stringify(ADMIN_ID)} })
            });
            const data = await res.json();
            alert(data.message);
            if (data.success) location.reload();
        }
    </script>
</body>
</html>
        `);
    } catch (err) {
        res.status(500).send('Admin dashboard error');
    }
});

app.post('/admin/action', async (req, res) => {
    try {
        const { reqId, action, adminKey } = req.body;
        if (adminKey !== ADMIN_ID) return res.status(403).json({ success: false, message: 'Unauthorized' });

        const result = await processRequest(String(reqId), action);
        res.status(result.success ? 200 : 400).json(result);
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/admin/manage-balance', async (req, res) => {
    try {
        const { userId, amount, action, adminKey } = req.body;
        if (adminKey !== ADMIN_ID) return res.status(403).json({ success: false, message: 'Unauthorized' });

        const user = await User.findOne({ id: String(userId) });
        if (!user) return res.status(404).json({ success: false, message: 'User not found!' });

        const value = Number(amount);
        if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ success: false, message: 'Invalid amount!' });

        if (action === 'add') {
            user.balance += value;
            await user.save();
            await sendTelegramMessage(user.id, `🎁 Admin added +${value} USDT to your balance.`);
            return res.json({ success: true, message: `Added ${value} USDT to ${user.id}` });
        } else if (action === 'cut') {
            user.balance = Math.max(0, user.balance - value);
            await user.save();
            await sendTelegramMessage(user.id, `⚠️ Admin deducted ${value} USDT from your balance.`);
            return res.json({ success: true, message: `Deducted ${value} USDT from ${user.id}` });
        }

        res.status(400).json({ success: false, message: 'Invalid action' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ==================== HEALTH CHECK ====================

app.get('/', (req, res) => res.send('BitHarvest Bot Server is running.'));

async function startServer() {
    if (!MONGO_URI || !ADMIN_ID) throw new Error('Missing environment variables');
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB connected');
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
}

startServer().catch(err => {
    console.error('Startup failed:', err.message);
    process.exit(1);
});
