Const express = require('express');
Const app = express();

Const BOT_TOKEN = '8655058369:AAGo-4rFve2eK21RbVk6CXc6e2_wwbrLCCQ';
Const ADMIN_ID = '7482625921';

App.use(express.json());

App.use((req, res, next) => {
    Res.header('Access-Control-Allow-Origin', '*');
    Res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    Res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    Next();
});

Let users = {};
Let pendingRequests = {};

Async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    Try {
        Let body = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
        If (replyMarkup) body.reply_markup = replyMarkup;
        Await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            Method: 'POST',
            Headers: { 'Content-Type': 'application/json' },
            Body: JSON.stringify(body)
        });
    } catch (e) {
        Console.log("Telegram API Error:", e);
    }
}

Async function editTelegramMessage(chatId, messageId, text, replyMarkup = null) {
    Try {
        Let body = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown' };
        If (replyMarkup) body.reply_markup = replyMarkup;
        Await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
            Method: 'POST',
            Headers: { 'Content-Type': 'application/json' },
            Body: JSON.stringify(body)
        });
    } catch (e) {
        Console.log("Telegram Edit Error:", e);
    }
}

Async function answerCallbackQuery(callbackQueryId, text) {
    Try {
        Await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            Method: 'POST',
            Headers: { 'Content-Type': 'application/json' },
            Body: JSON.stringify({ callback_query_id: callbackQueryId, text: text })
        });
    } catch (e) {
        Console.log("Callback Answer Error:", e);
    }
}

// Telegram Webhook Handler
App.post(`/api/webhook/${BOT_TOKEN}`, async (req, res) => {
    Const update = req.body;
    Res.sendStatus(200);

    Try {
        If (update.message) {
            Const msg = update.message;
            Const chatId = String(msg.chat.id);
            Const text = msg.text || '';

            // --- /start Command & Referral Link Logic ---
            If (text.startsWith('/start')) {
                Const parts = text.split(' ');
                Const referrerId = parts[1] ? String(parts[1]) : null;

                If (!users[chatId]) {
                    Users[chatId] = {
                        Id: chatId,
                        Username: msg.from.username || msg.from.first_name || 'User',
                        Balance: 0,
                        Ghs: 0,
                        LastClaimTime: Date.now(),
                        Deposits: [],
                        Withdrawals: [],
                        ReferredBy: referrerId || null,
                        Referrals: { level1: [], level2: [], level3: [] },
                        RefEarnings: { level1: 0, level2: 0, level3: 0 }
                    };

                    If (referrerId && users[referrerId] && referrerId !== chatId) {
                        Users[chatId].referredBy = referrerId;
                        If (!users[referrerId].referrals.level1.includes(chatId)) {
                            Users[referrerId].referrals.level1.push(chatId);
                            SendTelegramMessage(referrerId, `🎉 New Level 1 Referral Joined! ID: ${chatId}`);
                        }

                        Const level2Ref = users[referrerId].referredBy;
                        If (level2Ref && users[level2Ref]) {
                            If (!users[level2Ref].referrals.level2.includes(chatId)) {
                                Users[level2Ref].referrals.level2.push(chatId);
                            }

                            Const level3Ref = users[level2Ref].referredBy;
                            If (level3Ref && users[level3Ref]) {
                                If (!users[level3Ref].referrals.level3.includes(chatId)) {
                                    Users[level3Ref].referrals.level3.push(chatId);
                                }
                            }
                        }
                    }
                }

                Await sendTelegramMessage(chatId, "🚀 **Welcome to BitHarvest USDT Mining Mini App!**\n\nClick the **Open BitHarvest** button below to launch the app.");
            }

            // --- Admin Panel Command ---
            If (text === '/admin') {
                If (chatId !== String(ADMIN_ID)) return;
                Await sendTelegramMessage(chatId, "👑 **Admin Panel Commands:**\n\n📊 `/stats` - Total Bot Users\n👤 `/user <id>` or `/users <id>` - Check User Details\n➕ `/addbal <id> <amount>` - Add Balance\n➖ `/cutbal <id> <amount>` - Cut Balance\n📢 `/broadcast <message>` - Send to All");
            }

            // --- Admin: Total Users Check (/stats) ---
            If (text === '/stats') {
                If (chatId !== String(ADMIN_ID)) return;
                Const totalUsers = Object.keys(users).length;
                Await sendTelegramMessage(chatId, `📊 **Bot Statistics:**\n\n👥 **Total Registered Users:** ${totalUsers}`);
            }

            // --- Admin: Check User Details (/user <id> or /users <id>) ---
            If (text.startsWith('/user') || text.startsWith('/users')) {
                If (chatId !== String(ADMIN_ID)) return;
                Const targetId = text.split(' ')[1];
                If (!targetId) return sendTelegramMessage(chatId, "⚠️ Usage: `/user <id>`");
                Const u = users[targetId];
                If (!u) return sendTelegramMessage(chatId, "User not found in database!");

                // Calculate total approved deposits
                Const totalDeposit = (u.deposits || [])
                    .filter(d => d.status === 'PAID')
                    .reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);

                // Calculate total approved withdrawals
                Const totalWithdraw = (u.withdrawals || [])
                    .filter(w => w.status === 'PAID')
                    .reduce((sum, w) => sum + parseFloat(w.amount || 0), 0);

                // Calculate total referrals count
                Const l1 = u.referrals?.level1?.length || 0;
                Const l2 = u.referrals?.level2?.length || 0;
                Const l3 = u.referrals?.level3?.length || 0;
                Const totalReferrals = l1 + l2 + l3;

                Const userDetailsMsg = `👤 **User Info (${targetId})**\n` +
                    `Username: @${u.username}\n` +
                    `Balance: ${u.balance.toFixed(4)} USDT\n` +
                    `GHS Power: ${u.ghs}\n` +
                    `Referred By: ${u.referredBy || 'None'}\n` +
                    `👥 Total Referrals: ${totalReferrals} (L1:${l1}, L2: ${l2}, L3:${l3})\n` +
                    `📥 Total Deposit: ${totalDeposit.toFixed(2)} USDT\n` +
                    `📤 Total Withdraw: ${totalWithdraw.toFixed(2)} USDT`;

                Await sendTelegramMessage(chatId, userDetailsMsg);
            }

            // --- Admin: Add Balance ---
            If (text.startsWith('/addbal')) {
                If (chatId !== String(ADMIN_ID)) return;
                Const parts = text.split(' ');
                Const targetId = parts[1];
                Const amount = parseFloat(parts[2]);

                If (!targetId || isNaN(amount)) return sendTelegramMessage(chatId, "⚠️ Usage: `/addbal <id> <amount>`");
                If (!users[targetId]) return sendTelegramMessage(chatId, "User not found!");

                Users[targetId].balance += amount;
                SendTelegramMessage(chatId, `✅ Successfully added ${amount} USDT to User${targetId}`);
                SendTelegramMessage(targetId, `💰 Admin added ${amount} USDT to your balance!`).catch(() => {});
            }

            // --- Admin: Cut Balance ---
            If (text.startsWith('/cutbal')) {
                If (chatId !== String(ADMIN_ID)) return;
                Const parts = text.split(' ');
                Const targetId = parts[1];
                Const amount = parseFloat(parts[2]);

                If (!targetId || isNaN(amount)) return sendTelegramMessage(chatId, "⚠️ Usage: `/cutbal <id> <amount>`");
                If (!users[targetId]) return sendTelegramMessage(chatId, "User not found!");

                Users[targetId].balance -= amount;
                SendTelegramMessage(chatId, `✅ Successfully deducted ${amount} USDT from User${targetId}`);
                SendTelegramMessage(targetId, `⚠️ Admin deducted ${amount} USDT from your balance.`).catch(() => {});
            }

            // --- Admin: Broadcast Message ---
            If (text.startsWith('/broadcast')) {
                If (chatId !== String(ADMIN_ID)) return;
                Const messageText = text.replace('/broadcast', '').trim();
                If (!messageText) return sendTelegramMessage(chatId, "⚠️ Usage: `/broadcast <message>`");

                Let count = 0;
                Object.keys(users).forEach(id => {
                    SendTelegramMessage(id, `📢 **Announcement:**\n\n${messageText}`).catch(() => {});
                    Count++;
                });

                SendTelegramMessage(chatId, `✅ Broadcast sent to ${count} users!`);
            }

        } else if (update.callback_query) {
            Const query = update.callback_query;
            Const chatId = String(query.message.chat.id);
            Const data = query.data;
            Const messageId = query.message.message_id;

            // --- Deposit / Withdrawal Approvals ---
            If (data.startsWith('approve_') || data.startsWith('reject_')) {
                If (chatId !== String(ADMIN_ID)) {
                    Return answerCallbackQuery(query.id, "Unauthorized!");
                }

                Const isApprove = data.startsWith('approve_');
                Const reqKey = data.replace(isApprove ? 'approve_' : 'reject_', '');
                Const req = pendingRequests[reqKey];

                If (!req) {
                    Return answerCallbackQuery(query.id, "Request already handled or expired!");
                }

                Const u = users[req.userId];

                If (isApprove) {
                    If (req.type === 'deposit') {
                        If (u) {
                            Const depAmount = parseFloat(req.amount);
                            U.ghs += depAmount;
                            Const dep = u.deposits.find(d => d.id === req.reqId);
                            If (dep) dep.status = 'PAID';

                            // 3-Level Commission Distribution
                            Let currentU = u;
                            If (currentU.referredBy && users[currentU.referredBy]) {
                                Let l1User = users[currentU.referredBy];
                                Let comm1 = depAmount * 0.15;
                                L1User.balance += comm1;
                                L1User.refEarnings.level1 += comm1;
                                SendTelegramMessage(l1User.id, `🎁 Level 1 Commission Received: +${comm1.toFixed(4)} USDT!`);

                                If (l1User.referredBy && users[l1User.referredBy]) {
                                    Let l2User = users[l1User.referredBy];
                                    Let comm2 = depAmount * 0.02;
                                    L2User.balance += comm2;
                                    L2User.refEarnings.level2 += comm2;
                                    SendTelegramMessage(l2User.id, `🎁 Level 2 Commission Received: +${comm2.toFixed(4)} USDT!`);

                                    If (l2User.referredBy && users[l2User.referredBy]) {
                                        Let l3User = users[l2User.referredBy];
                                        Let comm3 = depAmount * 0.01;
                                        L3User.balance += comm3;
                                        L3User.refEarnings.level3 += comm3;
                                        SendTelegramMessage(l3User.id, `🎁 Level 3 Commission Received: +${comm3.toFixed(4)} USDT!`);
                                    }
                                }
                            }
                        }
                        SendTelegramMessage(req.userId, `✅ Your deposit of ${req.amount} USDT has been approved!${req.amount} GHS Power added.`);
                    } else if (req.type === 'withdraw') {
                        If (u) {
                            U.balance -= parseFloat(req.amount);
                            Const wd = u.withdrawals.find(w => w.id === req.reqId);
                            If (wd) wd.status = 'PAID';
                        }
                        SendTelegramMessage(req.userId, `✅ Your withdrawal of ${req.amount} USDT has been approved!`);
                    }
                    EditTelegramMessage(chatId, messageId, `✅ **Request Approved**\nUser ID: ${req.userId}\nAmount:${req.amount} USDT`);
                } else {
                    If (req.type === 'deposit') {
                        If (u) {
                            Const dep = u.deposits.find(d => d.id === req.reqId);
                            If (dep) dep.status = 'DECLINED';
                        }
                        SendTelegramMessage(req.userId, `❌ Your deposit request of ${req.amount} USDT was rejected.`);
                    } else if (req.type === 'withdraw') {
                        If (u) {
                            Const wd = u.withdrawals.find(w => w.id === req.reqId);
                            If (wd) wd.status = 'DECLINED';
                        }
                        SendTelegramMessage(req.userId, `❌ Your withdrawal request of ${req.amount} USDT was rejected.`);
                    }
                    EditTelegramMessage(chatId, messageId, `❌ **Request Rejected**\nUser ID: ${req.userId}\nAmount:${req.amount} USDT`);
                }

                Delete pendingRequests[reqKey];
                AnswerCallbackQuery(query.id, "Done!");
            }
        }
    } catch (err) {
        Console.log("Webhook error:", err);
    }
});

// User Data API for Mini App
App.get('/api/user/:userId', (req, res) => {
    Const userId = req.params.userId;
    If (!users[userId]) {
        Users[userId] = {
            Id: userId,
            Username: 'User',
            Balance: 0,
            Ghs: 0,
            LastClaimTime: Date.now(),
            Deposits: [],
            Withdrawals: [],
            ReferredBy: null,
            Referrals: { level1: [], level2: [], level3: [] },
            RefEarnings: { level1: 0, level2: 0, level3: 0 }
        };
    }
    Res.json(users[userId]);
});

// Claim Mining API
App.post('/api/claim', (req, res) => {
    Const { userId } = req.body;
    Const u = users[userId];
    If (!u) return res.status(400).json({ success: false, message: "User not found" });

    Let dailyProfit = u.ghs > 0 ? U.ghs * 0.3 : 0.01;
    Let perSecondRate = dailyProfit / 86400;
    Let elapsedSeconds = (Date.now() - u.lastClaimTime) / 1000;
    Let MinedAmount = Math.max(0, elapsedSeconds * perSecondRate);

    U.balance += MinedAmount;
    U.lastClaimTime = Date.now();

    Res.json({ success: true, balance: u.balance, lastClaimTime: u.lastClaimTime });
});

// Deposit API
App.post('/api/deposit', async (req, res) => {
    Const { userId, username, amount, txHash } = req.body;
    If (!userId || !amount) return res.status(400).json({ success: false, message: "Missing data" });

    If (!users[userId]) {
        Users[userId] = { id: userId, username: username || 'User', balance: 0, ghs: 0, lastClaimTime: Date.now(), deposits: [], withdrawals: [], referredBy: null, referrals: { level1: [], level2: [], level3: [] }, refEarnings: { level1: 0, level2: 0, level3: 0 } };
    }

    Const reqId = 'dep_' + Date.now();
    Const depositItem = { id: reqId, amount: amount, txHash: txHash, status: 'PENDING', date: new Date().toLocaleDateString() };
    
    Users[userId].deposits.unshift(depositItem);
    PendingRequests[reqId] = { type: 'deposit', userId: userId, amount: amount, txHash: txHash, reqId: reqId };

    Const msgText = `📥 **New Deposit Request**\n\n` +
                    `👤 **User:** ${username || userId} (ID: \`${userId}\`)\n` +
                    `💰 **Amount:** ${amount} USDT\n` +
                    `🔑 **TxHash:** \`${txHash}\``;

    Const keyboard = {
        Inline_keyboard: [
            [{ text: "✅ Approve", callback_data: `approve_${reqId}` }, { text: "❌ Reject", callback_data: `reject_${reqId}` }]
        ]
    };

    Await sendTelegramMessage(ADMIN_ID, msgText, keyboard);
    Res.json({ success: true, message: "Deposit request submitted successfully" });
});

// Withdraw API
App.post('/api/withdraw', async (req, res) => {
    Const { userId, username, amount, address } = req.body;
    If (!userId || !amount || !address) return res.status(400).json({ success: false, message: "Missing data" });

    If (!users[userId] || users[userId].balance < parseFloat(amount)) {
        Return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    Const reqId = 'wd_' + Date.now();
    Const withdrawItem = { id: reqId, amount: amount, address: address, status: 'PENDING', date: new Date().toLocaleDateString() };

    Users[userId].withdrawals.unshift(withdrawItem);
    PendingRequests[reqId] = { type: 'withdraw', userId: userId, amount: amount, address: address, reqId: reqId };

    Const msgText = `📤 **New Withdrawal Request**\n\n` +
                    `👤 **User:** ${username || userId} (ID: \`${userId}\`)\n` +
                    `💰 **Amount:** ${amount} USDT\n` +
                    `🏦 **Wallet Address:** \`${address}\``;

    Const keyboard = {
        Inline_keyboard: [
            [{ text: "✅ Approve", callback_data: `approve_${reqId}` }, { text: "❌ Reject", callback_data: `reject_${reqId}` }]
        ]
    };

    Await sendTelegramMessage(ADMIN_ID, msgText, keyboard);
    Res.json({ success: true, message: "Withdrawal request submitted successfully" });
});

Const PORT = process.env.PORT || 3000;
App.listen(PORT, async () => {
    Console.log(`Server running on port ${PORT}`);
    Const RENDER_URL = "https://bitharvest-qtyp.onrender.com";
    Try {
        Await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${RENDER_URL}/api/webhook/${BOT_TOKEN}`);
        Console.log("Telegram Webhook Set Successfully!");
    } catch (e) {
        Console.log("Failed to set webhook:", e);
    }
});
