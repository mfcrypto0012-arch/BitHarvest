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

// Webhook Handler
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
                await sendTelegramMessage(chatId, `👑 **BitHarvest Admin Access**\n\nClick below to open Admin Dashboard:`, {
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
                        const depAmount = parseFloat(req.amount);
                        u.ghs += depAmount; // 1 USDT = 1 GHS
                        
                        if (u.deposits && u.deposits.length > 0) {
                            u.deposits = u.deposits.map(d => {
                                if (d.id === req.reqId) {
                                    return { ...d, status: 'PAID' };
                                }
                                return d;
                            });
                        }
                        await u.save();

                        // Multi-level referral commission distribution
                        if (u.referredBy) {
                            let refL1 = await User.findOne({ id: u.referredBy });
                            if (refL1) {
                                let commL1 = depAmount * 0.15; // 15%
                                refL1.balance += commL1;
                                refL1.refEarnings.level1 = (refL1.refEarnings.level1 || 0) + commL1;
                                await refL1.save();
                                sendTelegramMessage(refL1.id, `🎁 Received +${commL1.toFixed(4)} USDT (15% Level 1 Referral Commission)!`);

                                if (refL1.referredBy) {
                                    let refL2 = await User.findOne({ id: refL1.referredBy });
                                    if (refL2) {
                                        let commL2 = depAmount * 0.02; // 2%
                                        refL2.balance += commL2;
                                        refL2.refEarnings.level2 = (refL2.refEarnings.level2 || 0) + commL2;
                                        await refL2.save();
                                        sendTelegramMessage(refL2.id, `🎁 Received +${commL2.toFixed(4)} USDT (2% Level 2 Referral Commission)!`);

                                        if (refL2.referredBy) {
                                            let refL3 = await User.findOne({ id: refL2.referredBy });
                                            if (refL3) {
                                                let commL3 = depAmount * 0.01; // 1%
                                                refL3.balance += commL3;
                                                refL3.refEarnings.level3 = (refL3.refEarnings.level3 || 0) + commL3;
                               
