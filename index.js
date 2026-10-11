const express = require('express');
const mongoose = require('mongoose');
const app = express();
​const BOT_TOKEN = '8655058369:AAGo-4rFve2eK21RbVk6CXc6e2_wwbrLCCQ';
const ADMIN_ID = '7482625921';
​// MongoDB Atlas Connection URI
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://Bhi123:Bhi123456@cluster0.uowvpoy.mongodb.net/bitharvest?retryWrites=true&w=majority';
​mongoose.connect(MONGO_URI)
.then(() => console.log('✅ Connected to MongoDB Atlas Successfully!'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));
​// Mongoose User Schema
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
​const User = mongoose.model('User', userSchema);
​app.use(express.json());
​app.use((req, res, next) => {
res.header('Access-Control-Allow-Origin', '*');
res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
next();
});
​let pendingRequests = {};
​async function sendTelegramMessage(chatId, text, replyMarkup = null) {
try {
let body = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
if (replyMarkup) body.reply_markup = replyMarkup;
await fetch(https://api.telegram.org/bot${BOT_TOKEN}/sendMessage, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(body)
});
} catch (e) {
console.log("Telegram API Error:", e);
}
}
​async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
try {
let body = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown' };
if (replyMarkup) body.reply_markup = replyMarkup;
await fetch(https://api.telegram.org/bot${BOT_TOKEN}/editMessageText, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(body)
});
} catch (e) {
console.log("Telegram Edit Error:", e);
}
}
​async function answerCallbackQuery(callbackQueryId, text) {
try {
await fetch(https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ callback_query_id: callbackQueryId, text: text })
});
} catch (e) {
console.log("Callback Answer Error:", e);
}
}
​// Telegram Webhook Handler
app.post(/api/webhook/${BOT_TOKEN}, async (req, res) => {
const update = req.body;
res.sendStatus(200);
​try {
if (update.message) {
const msg = update.message;
const chatId = String(msg.chat.id);
const text = msg.text || '';
​// --- /start Command & Referral Link Logic ---
if (text.startsWith('/start')) {
const parts = text.split(' ');
const referrerId = parts[1] ? String(parts[1]) : null;
​let user = await User.findOne({ id: chatId });
if (!user) {
user = new User({
id: chatId,
username: msg.from.username || msg.from.first_name || 'User',
balance: 0,
ghs: 0,
lastClaimTime: Date.now(),
referredBy: referrerId || null
});
​if (referrerId && referrerId !== chatId) {
const referrer = await User.findOne({ id: referrerId });
if (referrer) {
user.referredBy = referrerId;
if (!referrer.referrals.level1.includes(chatId)) {
referrer.referrals.level1.push(chatId);
sendTelegramMessage(referrerId, 🎉 New Level 1 Referral Joined! ID: ${chatId});
}
​const level2RefId = referrer.referredBy;
if (level2RefId) {
const level2User = await User.findOne({ id: level2RefId });
if (level2User) {
if (!level2User.referrals.level2.includes(chatId)) {
level2User.referrals.level2.push(chatId);
}
​const level3RefId = level2User.referredBy;
if (level3RefId) {
const level3User = await User.findOne({ id: level3RefId });
if (level3User && !level3User.referrals.level3.includes(chatId)) {
level3User.referrals.level3.push(chatId);
}
await level3User?.save();
}
await level2User.save();
}
}
await referrer.save();
}
}
await user.save();
}
​await sendTelegramMessage(chatId, "🚀 Welcome to BitHarvest USDT Mining Mini App!\n\nClick the button in the app to launch your dashboard.");
}
​// --- Admin Panel Command ---
if (text === '/admin') {
if (chatId !== String(ADMIN_ID)) return;
await sendTelegramMessage(chatId, "👑 Admin Panel Commands:\n\n📊 /stats - Total Bot Users\n👤 /user <id> or /users <id> - Check User Details\n➕ /addbal <id> <amount> - Add Balance\n➖ /cutbal <id> <amount> - Cut Balance\n📢 /broadcast <message> - Send to All");
}
​// --- Admin: Total Users Check (/stats) ---
if (text === '/stats') {
if (chatId !== String(ADMIN_ID)) return;
const totalUsers = await User.countDocuments();
await sendTelegramMessage(chatId, 📊 **Bot Statistics:**\n\n👥 **Total Registered Users:** ${totalUsers});
}
​// --- Admin: Check User Details ---
if (text.startsWith('/user') || text.startsWith('/users')) {
if (chatId !== String(ADMIN_ID)) return;
const targetId = text.split(' ')[1];
if (!targetId) return sendTelegramMessage(chatId, "⚠️ Usage: /user <id>");
​const u = await User.findOne({ id: targetId });
if (!u) return sendTelegramMessage(chatId, "User not found in database!");
​const totalDeposit = (u.deposits || [])
.filter(d => d.status === 'PAID')
.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
​const totalWithdraw = (u.withdrawals || [])
.filter(w => w.status === 'PAID')
.reduce((sum, w) => sum + parseFloat(w.amount || 0), 0);
​const l1 = u.referrals?.level1?.length || 0;
const l2 = u.referrals?.level2?.length || 0;
const l3 = u.referrals?.level3?.length || 0;
const totalReferrals = l1 + l2 + l3;
​const userDetailsMsg = 👤 **User Info (${targetId})**\n +
Username: @${u.username}\n +
Balance: ${u.balance.toFixed(4)} USDT\n +
GHS Power: ${u.ghs}\n +
Referred By: ${u.referredBy || 'None'}\n +
👥 Total Referrals: ${totalReferrals} (L1:${l1}, L2: ${l2}, L3:${l3})\n +
📥 Total Deposit: ${totalDeposit.toFixed(2)} USDT\n +
📤 Total Withdraw: ${totalWithdraw.toFixed(2)} USDT;
​await sendTelegramMessage(chatId, userDetailsMsg);
}
​// --- Admin: Add Balance ---
if (text.startsWith('/addbal')) {
if (chatId !== String(ADMIN_ID)) return;
const parts = text.split(' ');
const targetId = parts[1];
const amount = parseFloat(parts[2]);
​if (!targetId || isNaN(amount)) return sendTelegramMessage(chatId, "⚠️ Usage: /addbal <id> <amount>");
const u = await User.findOne({ id: targetId });
if (!u) return sendTelegramMessage(chatId, "User not found!");
​u.balance += amount;
await u.save();
sendTelegramMessage(chatId, ✅ Successfully added ${amount} USDT to User${targetId});
sendTelegramMessage(targetId, 💰 Admin added ${amount} USDT to your balance!).catch(() => {});
}
​// --- Admin: Cut Balance ---
if (text.startsWith('/cutbal')) {
if (chatId !== String(ADMIN_ID)) return;
const parts = text.split(' ');
const targetId = parts[1];
const amount = parseFloat(parts[2]);
​if (!targetId || isNaN(amount)) return sendTelegramMessage(chatId, "⚠️ Usage: /cutbal <id> <amount>");
const u = await User.findOne({ id: targetId });
if (!u) return sendTelegramMessage(chatId, "User not found!");
​u.balance -= amount;
await u.save();
sendTelegramMessage(chatId, ✅ Successfully deducted ${amount} USDT from User${targetId});
sendTelegramMessage(targetId, ⚠️ Admin deducted ${amount} USDT from your balance.).catch(() => {});
}
​// --- Admin: Broadcast Message ---
if (text.startsWith('/broadcast')) {
if (chatId !== String(ADMIN_ID)) return;
const messageText = text.replace('/broadcast', '').trim();
if (!messageText) return sendTelegramMessage(chatId, "⚠️ Usage: /broadcast <message>");
​const allUsers = await User.find({});
let count = 0;
for (let usr of allUsers) {
sendTelegramMessage(usr.id, 📢 **Announcement:**\n\n${messageText}).catch(() => {});
count++;
}
​sendTelegramMessage(chatId, ✅ Broadcast sent to ${count} users!);
}
​} else if (update.callback_query) {
const query = update.callback_query;
const chatId = String(query.message.chat.id);
const data = query.data;
const messageId = query.message.message_id;
​if (data.startsWith('approve_') || data.startsWith('reject_')) {
if (chatId !== String(ADMIN_ID)) {
return answerCallbackQuery(query.id, "Unauthorized!");
}
​const isApprove = data.startsWith('approve_');
const reqKey = data.replace(isApprove ? 'approve_' : 'reject_', '');
const req = pendingRequests[reqKey];
​if (!req) {
return answerCallbackQuery(query.id, "Request already handled or expired!");
}
​const u = await User.findOne({ id: req.userId });
​if (isApprove) {
if (req.type === 'deposit') {
if (u) {
const depAmount = parseFloat(req.amount);
u.ghs += depAmount;
const dep = u.deposits.find(d => d.id === req.reqId);
if (dep) dep.status = 'PAID';
​// 3-Level Commission Distribution
if (u.referredBy) {
let l1User = await User.findOne({ id: u.referredBy });
if (l1User) {
let comm1 = depAmount * 0.15;
l1User.balance += comm1;
l1User.refEarnings.level1 += comm1;
await l1User.save();
sendTelegramMessage(l1User.id, 🎁 Level 1 Commission Received: +${comm1.toFixed(4)} USDT!);
​if (l1User.referredBy) {
let l2User = await User.findOne({ id: l1User.referredBy });
if (l2User) {
let comm2 = depAmount * 0.02;
l2User.balance += comm2;
l2User.refEarnings.level2 += comm2;
await l2User.save();
sendTelegramMessage(l2User.id, 🎁 Level 2 Commission Received: +${comm2.toFixed(4)} USDT!);
​if (l2User.referredBy) {
let l3User = await User.findOne({ id: l2User.referredBy });
if (l3User) {
let comm3 = depAmount * 0.01;
l3User.balance += comm3;
l3User.refEarnings.level3 += comm3;
await l3User.save();
sendTelegramMessage(l3User.id, 🎁 Level 3 Commission Received: +${comm3.toFixed(4)} USDT!);
}
}
}
}
}
}
await u.save();
}
sendTelegramMessage(req.userId, ✅ Your deposit of ${req.amount} USDT has been approved!${req.amount} GHS Power added.);
} else if (req.type === 'withdraw') {
if (u) {
const wd = u.withdrawals.find(w => w.id === req.reqId);
if (wd) wd.status = 'PAID';
await u.save();
}
sendTelegramMessage(req.userId, ✅ Your withdrawal of ${req.amount} USDT has been approved and sent!);
}
editTelegramMessage(chatId, messageId, ✅ **Request Approved**\nUser ID: ${req.userId}\nAmount:${req.amount} USDT);
} else {
if (req.type === 'deposit') {
if (u) {
const dep = u.deposits.find(d => d.id === req.reqId);
if (dep) dep.status = 'DECLINED';
await u.save();
}
sendTelegramMessage(req.userId, ❌ Your deposit request of ${req.amount} USDT was rejected.);
} else if (req.type === 'withdraw') {
if (u) {
u.balance += parseFloat(req.amount); // Refund balance back to user if rejected
const wd = u.withdrawals.find(w => w.id === req.reqId);
if (wd) wd.status = 'DECLINED';
await u.save();
}
sendTelegramMessage(req.userId, ❌ Your withdrawal request of ${req.amount} USDT was rejected and refunded to your balance.);
}
editTelegramMessage(chatId, messageId, ❌ **Request Rejected**\nUser ID: ${req.userId}\nAmount:${req.amount} USDT);
}
​delete pendingRequests[reqKey];
answerCallbackQuery(query.id, "Done!");
}
}
} catch (err) {
console.log("Webhook error:", err);
}
});
​// User Data API for Mini App
app.get('/api/user/:userId', async (req, res) => {
const userId = req.params.userId;
let user = await User.findOne({ id: userId });
if (!user) {
user = new User({
id: userId,
username: 'User',
balance: 0,
ghs: 0,
lastClaimTime: Date.now()
});
await user.save();
}
res.json(user);
});
​// Claim Mining API
app.post('/api/claim', async (req, res) => {
const { userId } = req.body;
const u = await User.findOne({ id: userId });
if (!u) return res.status(400).json({ success: false, message: "User not found" });
​let dailyProfit = u.ghs > 0 ? u.ghs * 0.3 : 0.01;
let perSecondRate = dailyProfit / 86400;
let elapsedSeconds = (Date.now() - u.lastClaimTime) / 1000;
let MinedAmount = Math.max(0, elapsedSeconds * perSecondRate);
​u.balance += MinedAmount;
u.lastClaimTime = Date.now();
await u.save();
​res.json({ success: true, balance: u.balance, lastClaimTime: u.lastClaimTime });
});
​// Deposit API
app.post('/api/deposit', async (req, res) => {
const { userId, username, amount, txHash } = req.body;
let amt = parseFloat(amount);
if (!userId || !amt || amt <= 0) return res.status(400).json({ success: false, message: "Invalid amount" });
​let u = await User.findOne({ id: userId });
if (!u) {
u = new User({ id: userId, username: username || 'User', balance: 0, ghs: 0, lastClaimTime: Date.now() });
}
​const reqId = 'dep_' + Date.now();
const depositItem = { id: reqId, amount: amt, txHash: txHash, status: 'PENDING', date: new Date().toLocaleDateString() };
​u.deposits.unshift(depositItem);
await u.save();
​pendingRequests[reqId] = { type: 'deposit', userId: userId, amount: amt, txHash: txHash, reqId: reqId };
​const msgText = 📥 **New Deposit Request**\n\n +
👤 **User:** ${username || userId} (ID: \${userId}`)\n+💰 Amount: {amt} USDT\n` +
`🔑 **TxHash:** \`{txHash}``;
​const keyboard = {
inline_keyboard: [
[{ text: "✅ Approve", callback_data: approve_${reqId} }, { text: "❌ Reject", callback_data: reject_${reqId} }]
]
};
​await sendTelegramMessage(ADMIN_ID, msgText, keyboard);
res.json({ success: true, message: "Deposit request submitted successfully" });
});
​// Withdraw API
app.post('/api/withdraw', async (req, res) => {
const { userId, username, amount, address } = req.body;
let amt = parseFloat(amount);
if (!userId || !amt || !address || amt <= 0) return res.status(400).json({ success: false, message: "Missing data" });
​let u = await User.findOne({ id: userId });
if (!u || u.balance < amt) {
return res.status(400).json({ success: false, message: "Insufficient balance" });
}
​u.balance -= amt; // Deduct immediately when request is placed
​const reqId = 'wd_' + Date.now();
const withdrawItem = { id: reqId, amount: amt, address: address, status: 'PENDING', date: new Date().toLocaleDateString() };
​u.withdrawals.unshift(withdrawItem);
await u.save();
​pendingRequests[reqId] = { type: 'withdraw', userId: userId, amount: amt, address: address, reqId: reqId };
​const msgText = 📤 **New Withdrawal Request**\n\n +
👤 **User:** ${username || userId} (ID: \${userId}`)\n+💰 Amount: {amt} USDT\n` +
`🏦 **Wallet Address:** \`{address}``;
​const keyboard = {
inline_keyboard: [
[{ text: "✅ Approve", callback_data: approve_${reqId} }, { text: "❌ Reject", callback_data: reject_${reqId} }]
]
};
​await sendTelegramMessage(ADMIN_ID, msgText, keyboard);
res.json({ success: true, message: "Withdrawal request submitted successfully" });
});
​const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
console.log(Server running on port ${PORT});
const RENDER_URL = "https://bitharvest-qtyp.onrender.com";
try {
await fetch(https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${RENDER_URL}/api/webhook/${BOT_TOKEN});
console.log("Telegram Webhook Set Successfully!");
} catch (e) {
console.log("Failed to set webhook:", e);
}
});
