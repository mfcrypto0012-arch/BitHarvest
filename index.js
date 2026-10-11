require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const ADMIN_ID = process.env.ADMIN_ID || '7482625921'; // Set your admin telegram user ID

const bot = new Telegraf(BOT_TOKEN);

// In-memory Database (Replace with MongoDB in production if needed)
let users = {};

/*
  User Data Structure:
  users[userId] = {
    userId: "12345",
    username: "john",
    balance: 0.0,
    ghs: 0,
    lastClaimTime: Date.now(),
    deposits: [ { id: "dep_1", amount: 10, txHash: "0x...", status: "PENDING", date: "10/11/2026" } ],
    withdrawals: [ { id: "wth_1", amount: 0.5, address: "0x...", status: "PENDING", date: "10/11/2026" } ],
    referrer: null,
    referrals: { level1: [], level2: [], level3: [] },
    refEarnings: { level1: 0, level2: 0, level3: 0 }
  }
*/

function getUser(userId, username = "User") {
  if (!users[userId]) {
    users[userId] = {
      userId: String(userId),
      username: username,
      balance: 0,
      ghs: 0,
      lastClaimTime: Date.now(),
      deposits: [],
      withdrawals: [],
      referrer: null,
      referrals: { level1: [], level2: [], level3: [] },
      refEarnings: { level1: 0, level2: 0, level3: 0 }
    };
  }
  return users[userId];
}

// ------------------- API ENDPOINTS -------------------

// Get User Profile
app.get('/api/user/:userId', (req, res) => {
  const { userId } = req.params;
  const user = getUser(userId);
  res.json(user);
});

// Claim Mining Rewards
app.post('/api/claim', (req, res) => {
  const { userId } = req.body;
  const user = getUser(userId);

  const dailyProfit = user.ghs > 0 ? user.ghs * 0.3 : 0.01;
  const perSecondRate = dailyProfit / 86400;
  const elapsedSeconds = (Date.now() - user.lastClaimTime) / 1000;
  const pendingAmount = Math.max(0, elapsedSeconds * perSecondRate);

  if (pendingAmount <= 0) {
    return res.status(400).json({ success: false, message: "Nothing to claim yet!" });
  }

  user.balance += pendingAmount;
  user.lastClaimTime = Date.now();

  res.json({
    success: true,
    balance: user.balance,
    lastClaimTime: user.lastClaimTime
  });
});

// Submit Deposit Request
app.post('/api/deposit', async (req, res) => {
  const { userId, username, amount, txHash } = req.body;
  const user = getUser(userId, username);

  const depId = 'DEP_' + Date.now();
  const dateStr = new Date().toLocaleDateString('en-GB');

  const newDep = {
    id: depId,
    amount: parseFloat(amount),
    txHash: txHash,
    status: 'PENDING',
    date: dateStr
  };

  user.deposits.unshift(newDep);

  // Send Notification to Admin in Telegram with Approve/Reject inline buttons
  try {
    const msg = `📥 *New Deposit Request*\n\n👤 *User ID:* \`${userId}\`\n👤 *Username:* @${username}\n💰 *Amount:* ${amount} USDT\n🔑 *TxHash:* \`${txHash}\`\n🆔 *Req ID:* \`${depId}\``;

    await bot.telegram.sendMessage(ADMIN_ID, msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Approve', `app_dep_${userId}_${depId}`),
          Markup.button.callback('❌ Reject', `rej_dep_${userId}_${depId}`)
        ]
      ])
    });
  } catch (err) {
    console.error("Error sending Telegram admin alert:", err);
  }

  res.json({ success: true, message: "Deposit request submitted successfully!", deposit: newDep });
});

// Submit Withdrawal Request
app.post('/api/withdraw', async (req, res) => {
  const { userId, username, amount, address } = req.body;
  const user = getUser(userId, username);

  const numAmt = parseFloat(amount);
  if (user.balance < numAmt) {
    return res.status(400).json({ success: false, message: "Insufficient balance!" });
  }

  user.balance -= numAmt; // Deduct balance provisionally

  const wthId = 'WTH_' + Date.now();
  const dateStr = new Date().toLocaleDateString('en-GB');

  const newWth = {
    id: wthId,
    amount: numAmt,
    address: address,
    status: 'PENDING',
    date: dateStr
  };

  user.withdrawals.unshift(newWth);

  // Send Notification to Admin
  try {
    const msg = `📤 *New Withdrawal Request*\n\n👤 *User ID:* \`${userId}\`\n👤 *Username:* @${username}\n💰 *Amount:* ${amount} USDT\n🏦 *Address:* \`${address}\`\n🆔 *Req ID:* \`${wthId}\``;

    await bot.telegram.sendMessage(ADMIN_ID, msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Approve', `app_wth_${userId}_${wthId}`),
          Markup.button.callback('❌ Reject', `rej_wth_${userId}_${wthId}`)
        ]
      ])
    });
  } catch (err) {
    console.error("Error sending Telegram admin alert:", err);
  }

  res.json({ success: true, message: "Withdrawal request submitted successfully!", withdrawal: newWth });
});


// ------------------- TELEGRAM BOT HANDLERS -------------------

// Start command
bot.start((ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  getUser(userId, username);

  ctx.reply(`Welcome to BitHarvest Mining Bot!`, 
    Markup.keyboard([
      [Markup.button.webApp("🚀 Open BitHarvest App", process.env.WEBAPP_URL || "https://your-netlify-url.netlify.app")]
    ]).resize()
  );
});

// Admin Command
bot.command('admin', (ctx) => {
  if (String(ctx.from.id) !== String(ADMIN_ID)) return ctx.reply("Unauthorized!");
  ctx.reply("👑 *BitHarvest Admin Panel*\n\nCommands:\n/stats - Bot stats\n/addbal <id> <amount> - Add balance\n/cutbal <id> <amount> - Cut balance", { parse_mode: 'Markdown' });
});

// TELEGRAM CALLBACK BUTTON HANDLERS (APPROVE / REJECT)

// 1. APPROVE DEPOSIT
bot.action(/^app_dep_(.+)_(.+)$/, async (ctx) => {
  const userId = ctx.match[1];
  const depId = ctx.match[2];

  const user = users[userId];
  if (!user) return ctx.answerCbQuery("User not found!");

  const dep = user.deposits.find(d => d.id === depId);
  if (!dep) return ctx.answerCbQuery("Deposit request not found!");

  if (dep.status !== 'PENDING') {
    return ctx.answerCbQuery(`Request already ${dep.status}!`);
  }

  // Update Deposit Status to PAID / APPROVED
  dep.status = 'PAID';
  user.ghs += dep.amount; // 1 USDT = 1 GHS

  await ctx.editMessageText(ctx.callbackQuery.message.text + `\n\n✅ *STATUS: APPROVED (+${dep.amount} GHS Added)*`, { parse_mode: 'Markdown' });
  ctx.answerCbQuery("Deposit Approved!");

  // Notify User via Bot
  try {
    await bot.telegram.sendMessage(userId, `🎉 *Deposit Approved!*\n\nYour deposit of *${dep.amount} USDT* has been verified. *+${dep.amount} GHS* has been added to your mining account!`, { parse_mode: 'Markdown' });
  } catch (e) {}
});

// 2. REJECT DEPOSIT
bot.action(/^rej_dep_(.+)_(.+)$/, async (ctx) => {
  const userId = ctx.match[1];
  const depId = ctx.match[2];

  const user = users[userId];
  if (!user) return ctx.answerCbQuery("User not found!");

  const dep = user.deposits.find(d => d.id === depId);
  if (!dep) return ctx.answerCbQuery("Deposit request not found!");

  if (dep.status !== 'PENDING') {
    return ctx.answerCbQuery(`Request already ${dep.status}!`);
  }

  dep.status = 'DECLINED';

  await ctx.editMessageText(ctx.callbackQuery.message.text + `\n\n❌ *STATUS: REJECTED*`, { parse_mode: 'Markdown' });
  ctx.answerCbQuery("Deposit Rejected!");

  try {
    await bot.telegram.sendMessage(userId, `❌ *Deposit Rejected*\n\nYour deposit request of *${dep.amount} USDT* was rejected. Please contact support if you think this is an error.`, { parse_mode: 'Markdown' });
  } catch (e) {}
});

// 3. APPROVE WITHDRAWAL
bot.action(/^app_wth_(.+)_(.+)$/, async (ctx) => {
  const userId = ctx.match[1];
  const wthId = ctx.match[2];

  const user = users[userId];
  if (!user) return ctx.answerCbQuery("User not found!");

  const wth = user.withdrawals.find(w => w.id === wthId);
  if (!wth) return ctx.answerCbQuery("Withdrawal request not found!");

  if (wth.status !== 'PENDING') {
    return ctx.answerCbQuery(`Request already ${wth.status}!`);
  }

  wth.status = 'PAID';

  await ctx.editMessageText(ctx.callbackQuery.message.text + `\n\n✅ *STATUS: PAID / APPROVED*`, { parse_mode: 'Markdown' });
  ctx.answerCbQuery("Withdrawal Approved!");

  try {
    await bot.telegram.sendMessage(userId, `🎉 *Withdrawal Approved!*\n\nYour withdrawal request of *${wth.amount} USDT* has been processed and paid!`, { parse_mode: 'Markdown' });
  } catch (e) {}
});

// 4. REJECT WITHDRAWAL
bot.action(/^rej_wth_(.+)_(.+)$/, async (ctx) => {
  const userId = ctx.match[1];
  const wthId = ctx.match[2];

  const user = users[userId];
  if (!user) return ctx.answerCbQuery("User not found!");

  const wth = user.withdrawals.find(w => w.id === wthId);
  if (!wth) return ctx.answerCbQuery("Withdrawal request not found!");

  if (wth.status !== 'PENDING') {
    return ctx.answerCbQuery(`Request already ${wth.status}!`);
  }

  wth.status = 'DECLINED';
  user.balance += wth.amount; // Refund user balance if rejected

  await ctx.editMessageText(ctx.callbackQuery.message.text + `\n\n❌ *STATUS: REJECTED (Refunded)*`, { parse_mode: 'Markdown' });
  ctx.answerCbQuery("Withdrawal Rejected!");

  try {
    await bot.telegram.sendMessage(userId, `❌ *Withdrawal Rejected*\n\nYour withdrawal request of *${wth.amount} USDT* was rejected and funds have been refunded to your app balance.`, { parse_mode: 'Markdown' });
  } catch (e) {}
});

// Launch Bot & Server
bot.launch();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
