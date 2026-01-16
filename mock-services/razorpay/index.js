/**
 * Razorpay Payment API Mock
 * Simulates Razorpay payment gateway for load testing
 */

const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8082;
const DELAY_MS = parseInt(process.env.RESPONSE_DELAY_MS) || 100;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let requestCount = 0;

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'mock-razorpay', requests: requestCount });
});

// Create order
app.post('/v1/orders', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    const orderId = `order_${crypto.randomBytes(8).toString('hex')}`;

    res.json({
        id: orderId,
        entity: 'order',
        amount: req.body.amount || 50000,
        amount_paid: 0,
        amount_due: req.body.amount || 50000,
        currency: req.body.currency || 'INR',
        receipt: req.body.receipt || `receipt_${Date.now()}`,
        status: 'created',
        attempts: 0,
        created_at: Math.floor(Date.now() / 1000)
    });
});

// Fetch order
app.get('/v1/orders/:orderId', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        id: req.params.orderId,
        entity: 'order',
        amount: 50000,
        amount_paid: 50000,
        amount_due: 0,
        currency: 'INR',
        status: 'paid',
        attempts: 1,
        created_at: Math.floor(Date.now() / 1000)
    });
});

// Capture payment
app.post('/v1/payments/:paymentId/capture', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        id: req.params.paymentId,
        entity: 'payment',
        amount: req.body.amount || 50000,
        currency: req.body.currency || 'INR',
        status: 'captured',
        order_id: `order_${crypto.randomBytes(8).toString('hex')}`,
        method: 'upi',
        captured: true,
        created_at: Math.floor(Date.now() / 1000)
    });
});

// Fetch payment
app.get('/v1/payments/:paymentId', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        id: req.params.paymentId,
        entity: 'payment',
        amount: 50000,
        currency: 'INR',
        status: 'captured',
        method: 'upi',
        captured: true,
        description: 'Test payment',
        created_at: Math.floor(Date.now() / 1000)
    });
});

// Verify payment signature (always success for mock)
app.post('/v1/payments/verify', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        valid: true,
        verified: true
    });
});

// Refund
app.post('/v1/payments/:paymentId/refund', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        id: `rfnd_${crypto.randomBytes(8).toString('hex')}`,
        entity: 'refund',
        amount: req.body.amount || 50000,
        currency: 'INR',
        payment_id: req.params.paymentId,
        status: 'processed',
        created_at: Math.floor(Date.now() / 1000)
    });
});

// Settlements
app.get('/v1/settlements', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        entity: 'collection',
        count: 1,
        items: [{
            id: `setl_${crypto.randomBytes(8).toString('hex')}`,
            entity: 'settlement',
            amount: 100000,
            status: 'processed',
            fees: 2000,
            tax: 360,
            utr: `UTR${Date.now()}`,
            created_at: Math.floor(Date.now() / 1000)
        }]
    });
});

app.all('*', (req, res) => {
    requestCount++;
    res.json({ success: true, mock: true, path: req.path });
});

app.listen(PORT, () => {
    console.log(`Mock Razorpay API running on port ${PORT}`);
});
