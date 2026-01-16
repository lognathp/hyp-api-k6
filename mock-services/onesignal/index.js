/**
 * OneSignal Push Notification API Mock
 * Simulates OneSignal for load testing
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8083;
const DELAY_MS = parseInt(process.env.RESPONSE_DELAY_MS) || 30;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let requestCount = 0;

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'mock-onesignal', requests: requestCount });
});

// Send notification
app.post('/notifications', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        id: uuidv4(),
        recipients: req.body.include_player_ids?.length || 1,
        external_id: null
    });
});

// Register user identity
app.patch('/apps/:appId/users/by/onesignal_id/:userId/identity', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        identity: {
            onesignal_id: req.params.userId,
            external_id: req.body.identity?.external_id || `ext_${Date.now()}`
        }
    });
});

// Delete user
app.delete('/apps/:appId/users/by/onesignal_id/:userId', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.status(200).json({ success: true });
});

// Get notification
app.get('/notifications/:notificationId', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        id: req.params.notificationId,
        successful: 1,
        failed: 0,
        converted: 0,
        remaining: 0,
        queued_at: Math.floor(Date.now() / 1000),
        completed_at: Math.floor(Date.now() / 1000)
    });
});

// Create user
app.post('/apps/:appId/users', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        identity: {
            onesignal_id: uuidv4(),
            external_id: req.body.identity?.external_id
        },
        subscriptions: []
    });
});

app.all('*', (req, res) => {
    requestCount++;
    res.json({ success: true, mock: true });
});

app.listen(PORT, () => {
    console.log(`Mock OneSignal API running on port ${PORT}`);
});
