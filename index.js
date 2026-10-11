const express = require('express');
const mongoose = require('mongoose');
const https = require('https');

const app = express();

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

// Safe Telegram HTTP request helper (fixes fetch issues on older Node versions)
function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (!BOT_TOKEN) return;
    const data = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
    });

    const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    const req = https.request(options, (res) => {
        res.on('data', () => {});
    });

    req.on('error', (e) => {
        console.log("Telegram Error:", e.message);
    });

    req.write(data);
    req.end();
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
                                await referrer.save();
                                sendTelegramMessage(referrerId, `New Level 1 Referral Joined! ID: ${chatId}`);
                            }
                        }
                    }
                    await user.save();
                }
                const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://bitharvest-qtyp.onrender.com';
                sendTelegramMessage(chatId, "🚀 Welcome to BitHarvest USDT Mining Mini App!", {
                    inline_keyboard: [[
                        { text: "⛏️ Open Mining App", web_app: { url: RENDER_URL } }
                    ]]
                });
            } else if (text === '/admin' && chatId === String(ADMIN_ID)) {
                const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://bitharvest-qtyp.onrender.com';
                sendTelegramMessage(chatId, `Admin Dashboard Access:`, {
                    inline_keyboard: [[
                        { text: "Open Admin Dashboard", url: `${RENDER_URL}/admin/dashboard?key=${ADMIN_ID}` }
                    ]]
                });
            }
        }
    } catch (err) {
        console.log("Webhook error:", err);
    }
});

app.get('/admin/dashboard', async (req, res) => {
    try {
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
                    * { box-sizing: border-box; font-family: sans-serif; }
                    body { background: #0c0a09; color: #f3f4f6; margin: 0; padding: 20px; }
                    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
                    .header h1 { color: #f59e0b; margin: 0; font-size: 24px; }
                    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 20px; }
                    .stat-card { background: #1c1917; border: 1px solid #292524; border-radius: 10px; padding: 12px; }
                    .stat-title { font-size: 10px; color: #a8a29e; text-transform: uppercase; }
                    .stat-value { font-size: 18px; font-weight: bold; color: #fbbf24; margin-top: 4px; }
                    .card { background: #1c1917; border: 1px solid #292524; border-radius: 10px; padding: 15px; margin-bottom: 15px; }
                    .card h3 { color: #f59e0b; margin-top: 0; font-size: 15px; border-bottom: 1px solid #292524; padding-bottom: 6px; }
                    .search-box { display: flex; gap: 8px; margin-bottom: 10px; }
                    input, textarea { background: #0c0a09; border: 1px solid #44403c; color: #fff; padding: 8px; border-radius: 6px; width: 100%; font-size: 13px; }
                    .btn { background: #f59e0b; color: #
