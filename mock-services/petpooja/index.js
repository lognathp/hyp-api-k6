/**
 * PetPooja POS API Mock
 */
const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8084;
const DELAY_MS = parseInt(process.env.RESPONSE_DELAY_MS) || 50;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let requestCount = 0;

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'mock-petpooja', requests: requestCount });
});

// Push order to POS
app.post('/order/push', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);
    res.json({
        success: true,
        order_id: req.body.order_id || `PP-${Date.now()}`,
        pos_order_id: `POS-${Date.now()}`,
        message: 'Order received successfully'
    });
});

// Menu sync
app.get('/menu', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);
    res.json({
        success: true,
        menu: {
            categories: [],
            items: [],
            last_updated: new Date().toISOString()
        }
    });
});

// Order status update
app.post('/order/status', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);
    res.json({ success: true, status: 'ACCEPTED' });
});

app.all('*', (req, res) => {
    requestCount++;
    res.json({ success: true, mock: true });
});

app.listen(PORT, () => console.log(`Mock PetPooja API on port ${PORT}`));
