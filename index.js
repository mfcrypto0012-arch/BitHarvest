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

app.post(`/api/webhook/${BOT_TOKEN}`, async (req, res) => {
    const update = req.body;
    res.sendStatus(200);

    try {
        if (update.message) {
            const msg = update.message;
            const chatId = String(msg.chat.id);
            const text = msg.text || '';

            if (text.startsWith('/start')) {
                // Parameter Extraction
                let referrerId = null;
                const match = text.match(/\/start\s+(\d+)/);
                if (match && match[1]) {
                    referrerId = String(match[1]).trim();
                }

                let user = await User.findOne({ id: chatId });
                let isNewUser = false;

                if (!user) {
                    isNewUser = true;
                    user = new User({
                        id: chatId,
                        username: msg.from.username || msg.from.first_name || 'User',
                        referredBy: (referrerId && referrerId !== chatId) ? referrerId : null
                    });
                    await user.save();
                } else if (!user.referredBy && referrerId && referrerId !== chatId) {
                    user.referredBy = referrerId;
                    await user.save();
                    isNewUser = true;
                }

                // Instant Referral Registering Logic
                if (isNewUser && user.referredBy) {
                    const l1Id = user.referredBy;
                    
                    // Level 1 Instant Count Add
                    await User.updateOne(
                        { id: l1Id },
                        { $addToSet: { "referrals.level1": chatId } }
                    );
                    sendTelegramMessage(l1Id, `🎉 *New Level 1 Referral Joined!*\nUser ID: \`${chatId}\``);

                    // Level 2 Instant Count Add
                    const refL1 = await User.findOne({ id: l1Id });
                    if (refL1 && refL1.referredBy) {
                        const l2Id = refL1.referredBy;
                        await User.updateOne(
                            { id: l2Id },
                            { $addToSet: { "referrals.level2": chatId } }
                        );

                        // Level 3 Instant Count Add
                        const refL2 = await User.findOne({ id: l2Id });
                        if (refL2 && refL2.referredBy) {
                            const l3Id = refL2.referredBy;
                            await User.updateOne(
                                { id: l3Id },
                                { $addToSet: { "referrals.level3": chatId } }
                            );
                        }
                    }
                }

                await sendTelegramMessage(chatId, "🚀 **Welcome to BitHarvest USDT Mining Mini App!**\n\nClick the WebApp button below to launch.");
            } else if (text === '/admin' && chatId === String(ADMIN_ID)) {
                await sendTelegramMessage(chatId, `👑 **BitHarvest Admin Access**\n\nClick below to open Admin Dashboard:`, {
                    inline_keyboard: [[ { text: "🌐 Open Admin Dashboard", url: `https://bitharvest-qtyp.onrender.com/admin/dashboard?key=${ADMIN_ID}` } ]]
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

                        // Commission Calculation on Approved Deposit
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

                    editTelegramMessage(chatId, messageId, `✅ **Request Approved**\nUser ID: ${reqDoc.userId}\nAmount:${reqDoc.amount} USDT`);
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

                    editTelegramMessage(chatId, messageId, `❌ **Request Rejected**\nUser ID: ${reqDoc.userId}\nAmount:${reqDoc.amount} USDT`);
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

    let html = `
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
                input, textarea { background: #0c0a09; border: 1px solid #44403c; color: #fff; padding: 10px; border-radius: 8px; width: 100%; font-size: 14px; }
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
                <span style="font-size: 12px; color: #22c55e;">● Live System</span>
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
                    <input type="hidden" name="key" value="${ADMIN_ID}">
                    <input type="text" name="search" placeholder="Enter Telegram User ID or Username" value="${searchId}">
                    <button type="submit" class="btn">Search</button>
                </form>
                ${searchedUser ? `
                    <div class="user-details-box">
                        <p>👤 <b>User Name:</b> @${searchedUser.username} | <b>ID:</b> <code>${searchedUser.id}</code></p>
                        <p>💰 <b>Current Balance:</b> <span style="color:#fbbf24; font-weight:bold;">${searchedUser.balance.toFixed(4)} USDT</span> | ⚡ <b>GHS Power:</b> ${searchedUser.ghs} GHS</p>
                        <p>📥 <b>Total Approved Deposit:</b> <span style="color:#22c55e; font-weight:bold;">${userTotalDeposit.toFixed(2)} USDT</span></p>
                        <p>📤 <b>Total Approved Withdraw:</b> <span style="color:#ef4444; font-weight:bold;">${userTotalWithdraw.toFixed(2)} USDT</span></p>
                        <p>👥 <b>Referrals Count:</b> L1: ${searchedUser.referrals?.level1?.length || 0} | L2: ${searchedUser.referrals?.level2?.length || 0} | L3: ${searchedUser.referrals?.level3?.length || 0}</p>
                        <p>🎁 <b>Total Referral Commission:</b> <span style="color:#fbbf24; font-weight:bold;">${totalRefEarn.toFixed(4)} USDT</span></p>
                        <p>🔗 <b>Referred By ID:</b> ${searchedUser.referredBy || 'Direct Join'}</p>
                        <hr style="border-color:#292524; margin:12px 0;">
                        <b>⚙️ Manage User Balance:</b>
                        <div style="display:flex; gap:10px; margin-top:8px;">
                            <input type="number" id="mod-amt" placeholder="Enter USDT amount">
                            <button class="btn btn-green" onclick="modifyBal('${searchedUser.id}', 'add')">+ Add</button>
                            <button class="btn btn-red" onclick="modifyBal('${searchedUser.id}', 'cut')">- Cut</button>
                        </div>
                    </div>
                ` : searchId ? `<p style="color:#ef4444; font-size:12px;">User not found!</p>` : ''}
            </div>
            <div class="card">
                <h3>⏳ Pending Requests</h3>
                ${requests.length === 0 ? `<p style="font-size:12px; color:#a8a29e;">No pending requests right now.</p>` : `
                    <table>
                        <tr><th>Type</th><th>User ID</th><th>Amount</th><th>Details</th><th>Action</th></tr>
                        ${requests.map(r => `
                            <tr>
                                <td><b style="color:${r.type === 'deposit' ? '#22c55e' : '#ef4444'}">${r.type.toUpperCase()}</b></td>
                                <td>${r.userId}</td>
                                <td><b>${r.amount} USDT</b></td>
                                <td>${r.txHash ? 'Tx: ' + r.txHash.substring(0, 10) + '...' : 'Addr: ' + r.address.substring(0, 10) + '...'}</td>
                                <td>
                                    <button class="btn btn-green" style="padding:4px 8px; font-size:11px;" onclick="handleReq('${r.reqId}', 'approve')">Approve</button>
                                    <button class="btn btn-red" style="padding:4px 8px; font-size:11px;" onclick="handleReq('${r.reqId}', 'reject')">Reject</button>
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
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ reqId, action, adminKey: '${ADMIN_ID}' })
                    });
                    let data = await res.json();
                    alert(data.message);
                    location.reload();
                }
                async function modifyBal(userId, action) {
                    let amount = document.getElementById('mod-amt').value;
                    if (!amount) return alert("Enter amount!");
                    let res = await fetch('/admin/manage-balance', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId, amount, action, adminKey: '${ADMIN_ID}' })
                    });
                    let data = await res.json();
                    alert(data.message);
                    location.reload();
                }
            </script>
        </body>
        </html>
    `;
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
    }

    await PendingRequest.deleteOne({ reqId });
    res.json({ success: true, message: "Action executed successfully!" });
});

app.post('/admin/manage-balance', async (req, res) => {
    const { userId, amount, action, adminKey } = req.body;
    if (adminKey !== ADMIN_ID) return res.status(403).json({ success: false, message: "Unauthorized" });

    const u = await User.findOne({ id: userId });
    if (!u) return res.status(404).json({ success: false, message: "User not found!" });

    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) return res.status(400).json({ success: false, message: "Invalid amount!" });

    if (action === 'add') {
        u.balance += val;
        await u.save();
        sendTelegramMessage(userId, `🎁 Admin added +${val} USDT to your balance.`);
        return res.json({ success: true, message: `Added ${val} USDT to${userId}` });
    } else if (action === 'cut') {
        u.balance = Math.max(0, u.balance - val);
        await u.save();
        sendTelegramMessage(userId, `⚠️ Admin deducted -${val} USDT from your balance.`);
        return res.json({ success: true, message: `Deducted ${val} USDT from${userId}` });
    }

    res.status(400).json({ success: false, message: "Invalid action" });
});

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
        let depObj = { id: reqId, amount: parseFloat(amount), txHash: txHash, status: 'PENDING', date: new Date().toLocaleDateString() };
        user.deposits.push(depObj);
        user.markModified('deposits');
        await user.save();

        let newReq = new PendingRequest({ reqId: reqId, type: 'deposit', userId: userId, amount: parseFloat(amount), txHash: txHash });
        await newReq.save();

        sendTelegramMessage(ADMIN_ID, `📥 *New Deposit Request*\n\nUser: @${username} (\`${userId}\`)\nAmount: \`${amount} USDT\`\nTxHash: \`${txHash}\``, {
            inline_keyboard: [[
                { text: "✅ Approve", callback_data: `approve_${reqId}` },
                { text: "❌ Reject", callback_data: `reject_${reqId}` }
            ]]
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
        let wthObj = { id: reqId, amount: parseFloat(amount), address: address, status: 'PENDING', date: new Date().toLocaleDateString() };
        user.withdrawals.push(wthObj);
        user.markModified('withdrawals');
        await user.save();

        let newReq = new PendingRequest({ reqId: reqId, type: 'withdraw', userId: userId, amount: parseFloat(amount), address: address });
        await newReq.save();

        sendTelegramMessage(ADMIN_ID, `📤 *New Withdrawal Request*\n\nUser: @${username} (\`${userId}\`)\nAmount: \`${amount} USDT\`\nAddress: \`${address}\``, {
            inline_keyboard: [[
                { text: "✅ Approve", callback_data: `approve_${reqId}` },
                { text: "❌ Reject", callback_data: `reject_${reqId}` }
            ]]
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || "https://bitharvest-qtyp.onrender.com";
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${RENDER_URL}/api/webhook/${BOT_TOKEN}`);
        console.log("Telegram Webhook Automatically Set!");
    } catch (err) {
        console.log("Webhook setup failed:", err);
    }
});
