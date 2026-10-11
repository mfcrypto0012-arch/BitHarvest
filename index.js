/* STREAMING_CHUNK:Initializing Express, Mongoose, and configurations... */
const express = require('express');
const mongoose = require('mongoose');

const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

/* STREAMING_CHUNK:Defining Mongoose User Schema... */
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

/* STREAMING_CHUNK:Defining Mongoose PendingRequest Schema... */
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
