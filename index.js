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
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization'
    );
    res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS'
    );

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

// ==================== DATABASE ====================

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

const User =
    mongoose.models.User || mongoose.model('User', userSchema);

const pendingRequestSchema = new mongoose.Schema({
    reqId: { type: String, required: true, unique: true },
    type: {
        type: String,
        required: true,
        enum: ['deposit', 'withdraw']
    },
    userId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    txHash: String,
    address: String,
    status: { type: String, default: 'PENDING' }
}, { timestamps: true });

const PendingRequest =
    mongoose.models.PendingRequest ||
    mongoose.model('PendingRequest', pendingRequestSchema);

// ==================== HELPERS ====================

function validAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 100000000
        ? n
        : null;
}

async function sendTelegramMessage(chatId, message, replyMarkup = null) {
    if (!BOT_TOKEN || !chatId) return;

    try {
        const body = {
            chat_id: chatId,
            text: message
        };

        if (replyMarkup) body.reply_markup = replyMarkup;

        const response = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }
        );

        const result = await response.json();

        if (!result.ok) {
            console.error('Telegram send error:', result.description);
        }
    } catch (err) {
        console.error('Telegram error:', err.message);
    }
}

async function editTelegramMessage(chatId, messageId, message) {
    if (!BOT_TOKEN) return;

    try {
        await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    message_id: messageId,
                    text: message
                })
            }
        );
    } catch (err) {
        console.error('Telegram edit error:', err.message);
    }
}

async function answerCallbackQuery(callbackQueryId, message) {
    if (!BOT_TOKEN) return;

    try {
        await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    callback_query_id: callbackQueryId,
                    text: message
                })
            }
        );
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
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

// ==================== REFERRALS ====================

async function addReferral(newUser) {
    if (!newUser.referredBy || newUser.referredBy === newUser.id) {
        return;
    }

    const first = await User.findOne({ id: newUser.referredBy });
    if (!first) return;

    if (!first.referrals.level1.includes(newUser.id)) {
        first.referrals.level1.push(newUser.id);
        await first.save();
    }

    if (!first.referredBy) return;

    const second = await User.findOne({ id: first.referredBy });
    if (!second) return;

    if (!second.referrals.level2.includes(newUser.id)) {
        second.referrals.level2.push(newUser.id);
        await second.save();
    }

    if (!second.referredBy) return;

    const third = await User.findOne({ id: second.referredBy });
    if (!third) return;

    if (!third.referrals.level3.includes(newUser.id)) {
        third.referrals.level3.push(newUser.id);
        await third.save();
    }
}

async function payReferralCommissions(user, depositAmount) {
    if (!user.referredBy) return;

    const levels = [
        { parentId: user.referredBy, rate: 0.15, key: 'level1' }
    ];

    const first = await User.findOne({ id: user.referredBy });

    if (first?.referredBy) {
        levels.push({
            parentId: first.referredBy,
            rate: 0.02,
            key: 'level2'
        });

        const second = await User.findOne({ id: first.referredBy });

        if (second?.referredBy) {
            levels.push({
                parentId: second.referredBy,
                rate: 0.01,
                key: 'level3'
            });
        }
    }

    for (const level of levels) {
        const commission = depositAmount * level.rate;

        await User.updateOne(
            { id: level.parentId },
            {
                $inc: {
                    balance: commission,
                    [`refEarnings.${level.key}`]: commission
                }
            }
        );

        await sendTelegramMessage(
            level.parentId,
            `🎁 Referral commission: +${commission.toFixed(4)} USDT`
        );
    }
}

// ==================== USER API ====================

app.get('/api/user/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();

        if (!/^\d{1,25}$/.test(id)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        let user = await User.findOne({ id });

        if (!user) {
            user = await User.create({ id });
        }

        res.json(user);
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/claim', async (req, res) => {
    try {
        const userId = String(req.body.userId || '');

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID required'
            });
        }

        const user = await User.findOne({ id: userId });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const now = Date.now();
        const last = Number(user.lastClaimTime) || now;
        const elapsed = Math.max(0, (now - last) / 1000);

        const dailyProfit = user.ghs > 0 ? user.ghs * 0.3 : 0.01;
        const earned = elapsed * dailyProfit / 86400;

        if (!Number.isFinite(earned) || earned < 0) {
            return res.status(400).json({ success: false });
        }

        user.balance += earned;
        user.lastClaimTime = now;

        await user.save();

        res.json({
            success: true,
            balance: user.balance,
            ghs: user.ghs,
            lastClaimTime: user.lastClaimTime
        });
    } catch (err) {
        console.error('Claim error:', err);
        res.status(500).json({ success: false });
    }
});

// ==================== DEPOSIT REQUEST ====================

app.post('/api/deposit', async (req, res) => {
    try {
        const userId = String(req.body.userId || '');
        const username = String(req.body.username || 'User');
        const amount = validAmount(req.body.amount);
        const txHash = String(req.body.txHash || '').trim();

        if (!userId || !amount || !txHash || txHash.length > 200) {
            return res.status(400).json({
                success: false,
                message: 'Invalid deposit details'
            });
        }

        const user = await User.findOne({ id: userId });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const reqId = `dep_${Date.now()}_${Math.random()
            .toString(36).slice(2, 8)}`;

        const request = await PendingRequest.create({
            reqId,
            type: 'deposit',
            userId,
            amount,
            txHash
        });

        user.deposits.push({
            id: reqId,
            amount,
            txHash,
            status: 'PENDING',
            date: new Date().toISOString()
        });

        await user.save();

        await notifyAdmin(
            `📥 NEW DEPOSIT REQUEST\n\nUser: ${username}\nID: ${userId}\nAmount: ${amount} USDT\nTx: ${txHash}`,
            {
                inline_keyboard: [[
                    { text: '✅ Approve', callback_data: `approve_${request.reqId}` },
                    { text: '❌ Reject', callback_data: `reject_${request.reqId}` }
                ]]
            }
        );

        res.json({ success: true, reqId });
    } catch (err) {
        console.error('Deposit error:', err);
        res.status(500).json({
            success: false,
            message: 'Could not submit deposit'
        });
    }
});

// ==================== WITHDRAW REQUEST ====================

app.post('/api/withdraw', async (req, res) => {
    try {
        const userId = String(req.body.userId || '');
        const username = String(req.body.username || 'User');
        const address = String(req.body.address || '').trim();
        const amount = validAmount(req.body.amount);

        if (!userId || !amount || !address || address.length > 200) {
            return res.status(400).json({
                success: false,
                message: 'Invalid withdrawal details'
            });
        }

        const user = await User.findOne({ id: userId });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const pending = await PendingRequest.aggregate([
            {
                $match: {
                    userId,
                    type: 'withdraw',
                    status: 'PENDING'
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' }
                }
            }
        ]);

        const pendingAmount = pending[0]?.total || 0;

        if (user.balance - pendingAmount < amount) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient available balance'
            });
        }

        const reqId = `wth_${Date.now()}_${Math.random()
            .toString(36).slice(2, 8)}`;

        const request = await PendingRequest.create({
            reqId,
            type: 'withdraw',
            userId,
            amount,
            address
        });

        user.withdrawals.push({
            id: reqId,
            amount,
            address,
            status: 'PENDING',
            date: new Date().toISOString()
        });

        await user.save();

        await notifyAdmin(
            `📤 NEW WITHDRAWAL REQUEST\n\nUser: ${username}\nID: ${userId}\nAmount: ${amount} USDT\nAddress: ${address}`,
            {
                inline_keyboard: [[
                    { text: '✅ Approve', callback_data: `approve_${request.reqId}` },
                    { text: '❌ Reject', callback_data: `reject_${request.reqId}` }
                ]]
            }
        );

        res.json({ success: true, reqId });
    } catch (err) {
        console.error('Withdrawal error:', err);
        res.status(500).json({
            success: false,
            message: 'Could not submit withdrawal'
        });
    }
});

// ==================== PROCESS REQUEST ====================

async function processRequest(reqId, action) {
    if (!['approve', 'reject'].includes(action)) {
        throw new Error('Invalid action');
    }

    const request = await PendingRequest.findOneAndUpdate(
        { reqId, status: 'PENDING' },
        { $set: { status: 'PROCESSING' } },
        { new: true }
    );

    if (!request) {
        throw new Error('Request already handled or not found');
    }

    try {
        const user = await User.findOne({ id: request.userId });

        if (!user) {
            throw new Error('User not found');
        }

        const list = request.type === 'deposit'
            ? user.deposits
            : user.withdrawals;

        const item = list.find(x => x.id === reqId);

        if (!item) {
            throw new Error('Request record missing from user history');
        }

        if (action === 'approve') {
            if (request.type === 'deposit') {
                user.ghs += request.amount;
                item.status = 'PAID';
                await user.save();

                await payReferralCommissions(user, request.amount);

                await sendTelegramMessage(
                    user.id,
                    `✅ Your deposit of ${request.amount} USDT has been approved.`
                );
            } else {
                if (user.balance < request.amount) {
                    throw new Error('Insufficient balance at approval');
                }

                user.balance -= request.amount;
                item.status = 'PAID';
                await user.save();

                await sendTelegramMessage(
                    user.id,
                    `✅ Your withdrawal of ${request.amount} USDT has been approved.`
                );
            }
        } else {
            item.status = 'DECLINED';
            await user.save();

            await sendTelegramMessage(
                user.id,
                `❌ Your ${request.type} request of ${request.amount} USDT was declined.`
            );
        }

        await PendingRequest.deleteOne({ reqId });

        return `${request.type} ${action}d successfully`;
    } catch (err) {
        await PendingRequest.updateOne(
            { reqId, status: 'PROCESSING' },
            { $set: { status: 'PENDING' } }
        );

        throw err;
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
                    const payload = text.split(/\s+/)[1] || '';
                    const referrerId = /^\d{1,25}$/.test(payload)
                        ? payload
                        : null;

                    let user = await User.findOne({ id: chatId });

                    if (!user) {
                        user = await User.create({
                            id: chatId,
                            username: msg.from.username ||
                                msg.from.first_name || 'User',
                            referredBy:
                                referrerId && referrerId !== chatId
                                    ? referrerId
                                    : null
                        });

                        await addReferral(user);
                    } else {
                        user.username = msg.from.username ||
                            msg.from.first_name || user.username;
                        await user.save();
                    }

                    await sendTelegramMessage(
                        chatId,
                        '🚀 Welcome to BitHarvest Mining Bot!\n\nOpen the Mini App to view your dashboard.'
                    );
                }

                if (text === '/admin' && chatId === ADMIN_ID) {
                    await sendTelegramMessage(
                        chatId,
                        '👑 BitHarvest Admin Panel',
                        {
                            inline_keyboard: [[
                                {
                                    text: '🌐 Open Admin Dashboard',
                                    url: `https://bitharvest-qtyp.onrender.com/admin/dashboard?key=${encodeURIComponent(ADMIN_ID)}`
                                }
                            ]]
                        }
                    );
                }
            }

            if (update.callback_query) {
                const query = update.callback_query;
                const chatId = String(query.message?.chat?.id || '');
                const data = query.data || '';

                if (chatId !== ADMIN_ID) {
                    await answerCallbackQuery(query.id, 'Unauthorized');
                    return;
                }

                if (data.startsWith('approve_') ||
                    data.startsWith('reject_')) {
                    const action = data.startsWith('approve_')
                        ? 'approve'
                        : 'reject';

                    const reqId = data.slice(action === 'approve' ? 8 : 7);

                    try {
                        const result = await processRequest(reqId, action);

                        await editTelegramMessage(
                            chatId,
                            query.message.message_id,
                            `✅ ${result}\nRequest: ${reqId}`
                        );

                        await answerCallbackQuery(query.id, 'Completed');
                    } catch (err) {
                        await answerCallbackQuery(query.id, err.message);
                    }
                }
            }
        } catch (err) {
            console.error('Webhook error:', err);
        }
    });
}

// ==================== ADMIN DASHBOARD ====================

app.get('/admin/dashboard', async (req, res) => {
    if (!adminAuthorized(req)) {
        return res.status(403).send('Unauthorized Access');
    }

    try {
        const totalUsers = await User.countDocuments();
        const users = await User.find().lean();
        const requests = await PendingRequest.find({
            status: 'PENDING'
        }).lean();

        const totalBalances = users.reduce(
            (sum, user) => sum + (user.balance || 0), 0
        );

        const totalPaidOut = users.reduce((sum, user) => {
            return sum + (user.withdrawals || [])
                .filter(w => w.status === 'PAID')
                .reduce((n, w) => n + Number(w.amount || 0), 0);
        }, 0);

        const search = String(req.query.search || '').trim();

        let searchedUser = null;

        if (search) {
            searchedUser = await User.findOne({
                $or: [
                    { id: search },
                    { username: search.replace(/^@/, '') }
                ]
            }).lean();
        }

        let userDetails = '';

        if (searchedUser) {
            const u = searchedUser;

            const approvedDeposits = (u.deposits || [])
                .filter(x => x.status === 'PAID')
                .reduce((s, x) => s + Number(x.amount || 0), 0);

            const approvedWithdrawals = (u.withdrawals || [])
                .filter(x => x.status === 'PAID')
                .reduce((s, x) => s + Number(x.amount || 0), 0);

            const referrals = u.referrals || {};
            const earnings = u.refEarnings || {};

            userDetails = `
                <section class="card">
                    <h2>User Details</h2>
                    <p>Name: ${escapeHtml(u.username)}</p>
                    <p>User ID: ${escapeHtml(u.id)}</p>
                    <p>Balance: ${Number(u.balance || 0).toFixed(4)} USDT</p>
                    <p>Mining power: ${Number(u.ghs || 0)} GHS</p>
                    <p>Approved deposits: ${approvedDeposits.toFixed(2)} USDT</p>
                    <p>Approved withdrawals: ${approvedWithdrawals.toFixed(2)} USDT</p>
                    <p>Referrals: L1 ${referrals.level1?.length || 0},
                       L2 ${referrals.level2?.length || 0},
                       L3 ${referrals.level3?.length || 0}</p>
                    <p>Referral earnings:
                       ${(
                           Number(earnings.level1 || 0) +
                           Number(earnings.level2 || 0) +
                           Number(earnings.level3 || 0)
                       ).toFixed(4)} USDT</p>
                    <form method="POST" action="/admin/manage-balance">
                        <input type="hidden" name="adminKey" value="${escapeHtml(ADMIN_ID)}">
                        <input type="hidden" name="userId" value="${escapeHtml(u.id)}">
                        <input name="amount" type="number" min="0.0001" step="any" required placeholder="Amount">
                        <button name="action" value="add">Add balance</button>
                        <button name="action" value="cut">Deduct balance</button>
                    </form>
                </section>
            `;
        } else if (search) {
            userDetails = '<section class="card">User not found.</section>';
        }

        const requestRows = requests.map(r => `
            <tr>
                <td>${escapeHtml(r.type)}</td>
                <td>${escapeHtml(r.userId)}</td>
                <td>${Number(r.amount).toFixed(4)} USDT</td>
                <td>${escapeHtml(r.txHash || r.address || '')}</td>
                <td>
                    <form method="POST" action="/admin/action">
                        <input type="hidden" name="adminKey" value="${escapeHtml(ADMIN_ID)}">
                        <input type="hidden" name="reqId" value="${escapeHtml(r.reqId)}">
                        <button name="action" value="approve">Approve</button>
                        <button name="action" value="reject">Reject</button>
                    </form>
                </td>
            </tr>
        `).join('');

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BitHarvest Admin</title>
<style>
body{margin:0;padding:18px;background:#0c0a09;color:#f5f5f4;font-family:Arial,sans-serif}
h1,h2{color:#fbbf24}
.card{background:#1c1917;padding:16px;border-radius:12px;margin:16px 0;overflow:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.stat{background:#292524;padding:14px;border-radius:9px}
input{max-width:100%;padding:10px;margin:5px 0;background:#0c0a09;color:white;border:1px solid #57534e;border-radius:6px}
button{padding:9px 12px;margin:3px;border:0;border-radius:6px;cursor:pointer;background:#fbbf24;color:#111;font-weight:bold}
table{width:100%;border-collapse:collapse;min-width:600px}
td,th{text-align:left;padding:9px;border-bottom:1px solid #44403c;overflow-wrap:anywhere}
a{color:#fbbf24}
</style>
</head>
<body>
<h1>👑 BitHarvest Admin Panel</h1>
<div class="grid">
<div class="stat">Total Users<h2>${totalUsers}</h2></div>
<div class="stat">User Balances<h2>${totalBalances.toFixed(2)} USDT</h2></div>
<div class="stat">Paid Out<h2>${totalPaidOut.toFixed(2)} USDT</h2></div>
<div class="stat">Pending Requests<h2>${requests.length}</h2></div>
</div>
<section class="card">
<h2>Search User</h2>
<form method="GET" action="/admin/dashboard">
<input type="hidden" name="key" value="${escapeHtml(ADMIN_ID)}">
<input name="search" value="${escapeHtml(search)}" placeholder="Telegram ID or username" required>
<button>Search</button>
</form>
</section>
${userDetails}
<section class="card">
<h2>Pending Requests</h2>
<table>
<tr><th>Type</th><th>User ID</th><th>Amount</th><th>Details</th><th>Action</th></tr>
${requestRows || '<tr><td colspan="5">No pending requests</td></tr>'}
</table>
</section>
</body>
</html>`);
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).send('Admin dashboard error');
    }
});

app.post('/admin/action', async (req, res) => {
    if (!adminAuthorized(req)) {
        return res.status(403).send('Unauthorized');
    }

    try {
        const result = await processRequest(
            String(req.body.reqId || ''),
            String(req.body.action || '')
        );

        res.send(`<p>${escapeHtml(result)}</p><a href="javascript:history.back()">Go back</a>`);
    } catch (err) {
        res.status(400).send(escapeHtml(err.message));
    }
});

app.post('/admin/manage-balance', async (req, res) => {
    if (!adminAuthorized(req)) {
        return res.status(403).send('Unauthorized');
    }

    try {
        const userId = String(req.body.userId || '');
        const amount = validAmount(req.body.amount);
        const action = String(req.body.action || '');

        if (!amount || !['add', 'cut'].includes(action)) {
            return res.status(400).send('Invalid amount or action');
        }

        const user = await User.findOne({ id: userId });

        if (!user) {
            return res.status(404).send('User not found');
        }

        if (action === 'add') {
            user.balance += amount;
        } else {
            user.balance = Math.max(0, user.balance - amount);
        }

        await user.save();

        await sendTelegramMessage(
            userId,
            action === 'add'
                ? `🎁 Admin added ${amount} USDT to your balance.`
                : `⚠️ Admin deducted ${amount} USDT from your balance.`
        );

        res.send(`<p>Balance updated successfully.</p><a href="/admin/dashboard?key=${encodeURIComponent(ADMIN_ID)}&search=${encodeURIComponent(userId)}">Return to user</a>`);
    } catch (err) {
        console.error('Balance update error:', err);
        res.status(500).send('Could not update balance');
    }
});

// ==================== HEALTH CHECK ====================

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        name: 'BitHarvest Backend',
        database: mongoose.connection.readyState === 1
            ? 'connected'
            : 'disconnected'
    });
});

// ==================== START SERVER ====================

async function startServer() {
    if (!MONGO_URI) {
        throw new Error('Missing MONGO_URI or MONGODB_URI environment variable');
    }

    if (!ADMIN_ID) {
        throw new Error('Missing ADMIN_ID environment variable');
    }

    await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 15000
    });

    console.log('✅ MongoDB connected');

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 BitHarvest server running on port ${PORT}`);
    });
}

startServer().catch(err => {
    console.error('❌ Server startup failed:', err.message);
    process.exit(1);
});
