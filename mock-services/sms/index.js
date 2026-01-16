/**
 * 2Factor SMS/OTP API Mock
 * Simulates 2factor.in SMS gateway for load testing
 *
 * Original URL format: https://2factor.in/API/V1/{key}/SMS/{mobile}/{otp}
 */

const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8086;
const DELAY_MS = parseInt(process.env.RESPONSE_DELAY_MS) || 50;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let requestCount = 0;
let otpStore = new Map(); // Store OTPs for verification

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'mock-sms-2factor', requests: requestCount });
});

// Send OTP - matches 2factor.in API format
// GET /API/V1/{key}/SMS/{mobile}/{otp}
app.get('/API/V1/:key/SMS/:mobile/:otp', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    const { key, mobile, otp } = req.params;

    // Store OTP for potential verification
    otpStore.set(mobile, {
        otp: otp,
        timestamp: Date.now(),
        verified: false
    });

    // Clean old OTPs (older than 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [m, data] of otpStore.entries()) {
        if (data.timestamp < tenMinutesAgo) {
            otpStore.delete(m);
        }
    }

    console.log(`OTP sent to ${mobile.slice(-4)}: ${otp}`);

    // 2factor.in success response format
    res.json({
        Status: 'Success',
        Details: `${crypto.randomBytes(16).toString('hex')}`,
        OTP: otp // Include for testing purposes
    });
});

// Verify OTP (optional endpoint for testing)
// GET /API/V1/{key}/SMS/VERIFY/{session_id}/{otp}
app.get('/API/V1/:key/SMS/VERIFY/:sessionId/:otp', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    const { otp } = req.params;

    // For load testing, always return success
    res.json({
        Status: 'Success',
        Details: 'OTP Matched'
    });
});

// Verify OTP by mobile (custom endpoint for testing)
app.get('/API/V1/:key/VERIFY/:mobile/:otp', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    const { mobile, otp } = req.params;
    const stored = otpStore.get(mobile);

    if (stored && stored.otp === otp) {
        stored.verified = true;
        res.json({
            Status: 'Success',
            Details: 'OTP Matched'
        });
    } else {
        res.json({
            Status: 'Error',
            Details: 'OTP Mismatch'
        });
    }
});

// Balance check (optional)
app.get('/API/V1/:key/BAL/:type', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        Status: 'Success',
        Details: '10000' // Mock balance
    });
});

// Transactional SMS
app.get('/API/V1/:key/ADDON_SERVICES/SEND/TSMS', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        Status: 'Success',
        Details: `${crypto.randomBytes(16).toString('hex')}`
    });
});

// Stats endpoint for monitoring
app.get('/stats', (req, res) => {
    res.json({
        requests: requestCount,
        otpStoreSize: otpStore.size,
        uptime: process.uptime()
    });
});

// Reset stats
app.post('/reset', (req, res) => {
    requestCount = 0;
    otpStore.clear();
    res.json({ message: 'Stats reset' });
});

// Catch-all for any other 2factor API paths
app.all('/API/*', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        Status: 'Success',
        Details: 'Mock response'
    });
});

// Need crypto for random IDs
const crypto = require('crypto');

app.listen(PORT, () => {
    console.log(`Mock 2Factor SMS API running on port ${PORT}`);
    console.log(`OTP endpoint: GET /API/V1/{key}/SMS/{mobile}/{otp}`);
});
