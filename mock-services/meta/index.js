/**
 * Meta/WhatsApp API Mock
 */
const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8085;
const DELAY_MS = parseInt(process.env.RESPONSE_DELAY_MS) || 30;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let requestCount = 0;

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'mock-meta', requests: requestCount });
});

// Send WhatsApp message
app.post('/v20.0/:phoneNumberId/messages', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);
    res.json({
        messaging_product: 'whatsapp',
        contacts: [{ wa_id: req.body.to }],
        messages: [{ id: `wamid.${Date.now()}` }]
    });
});

// Send template message
app.post('/v20.0/:phoneNumberId/messages/template', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);
    res.json({
        messaging_product: 'whatsapp',
        messages: [{ id: `wamid.template.${Date.now()}` }]
    });
});

app.all('*', (req, res) => {
    requestCount++;
    res.json({ success: true, mock: true });
});

app.listen(PORT, () => console.log(`Mock Meta/WhatsApp API on port ${PORT}`));
