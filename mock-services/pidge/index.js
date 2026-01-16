/**
 * Pidge Delivery API Mock
 * Simulates the Pidge delivery partner API for load testing
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8081;
const DELAY_MS = parseInt(process.env.RESPONSE_DELAY_MS) || 50;

// Simulate network delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Request counter for metrics
let requestCount = 0;

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'mock-pidge', requests: requestCount });
});

// Authentication - Token endpoint
app.post('/v1.0/store/auth/token', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        success: true,
        data: {
            token: `mock-pidge-token-${Date.now()}`,
            expires_in: 3600
        }
    });
});

// Create delivery order
// Request: { brand, channel, sender_detail, poc_detail, trips: [{ source_order_id, reference_id, ... }] }
// Response: { data: { "source_order_id": "delivery_order_id" } }
app.post('/v1.0/store/channel/vendor/order', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    // Extract source_order_id from trips array
    const trips = req.body?.trips || [];
    const responseData = {};

    // Generate delivery ID for each trip using source_order_id as key
    trips.forEach(trip => {
        const sourceOrderId = trip.source_order_id;
        if (sourceOrderId) {
            // Generate Pidge delivery ID format: timestamp + random alphanumeric
            const deliveryId = `${Date.now()}${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
            responseData[sourceOrderId] = deliveryId;
        }
    });

    // If no trips, generate a default response
    if (Object.keys(responseData).length === 0) {
        const defaultId = `${Date.now()}${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
        responseData['default'] = defaultId;
    }

    res.json({
        data: responseData
    });
});

// Fulfill delivery order
app.post('/v1.0/store/channel/vendor/order/fulfill', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        data: {
            fulfilled: false,
            message: 'Allocation successful',
            quote: null,
            network_id: 0,
            network_name: null
        }
    });
});

// Smart fulfill
app.post('/v1.0/store/channel/vendor/order/fulfill/smart', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS + 50); // Smart allocation takes slightly longer

    res.json({
        data: {
            fulfilled: false,
            message: 'Allocation successful',
            quote: null,
            network_id: 0,
            network_name: null
        }
    });
});

// Get order status
app.get('/v1.0/store/channel/vendor/order/:orderId', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    const statuses = ['CREATED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'];
    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

    res.json({
        success: true,
        data: {
            order_id: req.params.orderId,
            status: randomStatus,
            rider_location: {
                lat: 13.0827 + (Math.random() * 0.05),
                lng: 80.2707 + (Math.random() * 0.05)
            },
            updated_at: new Date().toISOString()
        }
    });
});

// Get rider location
app.get('/v1.0/store/tracking/rider-location', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        success: true,
        data: {
            rider_id: req.query.rider_id || 'RIDER-001',
            location: {
                latitude: 13.0827 + (Math.random() * 0.05),
                longitude: 80.2707 + (Math.random() * 0.05)
            }
        }
    });
});

// Cancel order
app.post('/v1.0/store/channel/vendor/order/:orderId/cancel', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        success: true,
        data: {
            order_id: req.params.orderId,
            status: 'CANCELLED',
            cancelled_at: new Date().toISOString()
        }
    });
});

// Delivery quote - matches actual Pidge API response structure
app.post('/v1.0/store/channel/vendor/quote', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    const pickupTime = new Date(Date.now() + 15 * 60000).toISOString();
    const dropTime = new Date(Date.now() + 30 * 60000).toISOString();

    // Extract ref from request for response
    const dropRef = req.body?.drop?.[0]?.ref || `PGQ${Date.now()}`;

    // Random distance between 2-10 km in meters
    const distanceMeters = Math.floor(Math.random() * 8000) + 2000;

    res.json({
        data: {
            distance: [
                {
                    ref: dropRef,
                    distance: distanceMeters
                }
            ],
            items: [
                {
                    network_id: 2,
                    network_name: "wefast",
                    service: "wefast",
                    pickup_now: true,
                    manifest: false,
                    quote: {
                        price: 138.27,
                        distance: distanceMeters,
                        eta: {
                            pickup: pickupTime,
                            pickup_min: 15,
                            drop: dropTime,
                            drop_min: 30
                        },
                        price_breakup: {
                            base_delivery_charge: 112.18,
                            total_gst_amount: 20.19,
                            surge: 0,
                            additional_charges: [
                                { type: "weight_fee_amount", value: null, details: "" },
                                { type: "insurance_amount", value: null, details: "" },
                                { type: "cod_fee_amount", value: null, details: "" }
                            ],
                            surge_breakup: {
                                total_surge_amount: 0
                            }
                        },
                        is_rain: false
                    },
                    error: null
                },
                {
                    network_id: 6,
                    network_name: "porter",
                    service: "porter",
                    pickup_now: true,
                    manifest: false,
                    quote: {
                        price: 131.87,
                        distance: distanceMeters,
                        eta: {
                            pickup: pickupTime,
                            pickup_min: 8,
                            drop: null,
                            drop_min: null
                        },
                        price_breakup: {
                            base_delivery_charge: 106.75,
                            total_gst_amount: 19.22,
                            surge: 0,
                            additional_charges: [],
                            surge_breakup: {
                                total_surge_amount: 0
                            }
                        },
                        is_rain: false
                    },
                    error: null
                },
                {
                    network_id: 4,
                    network_name: "shadowfax",
                    service: "shadowfax",
                    pickup_now: false,
                    manifest: false,
                    quote: {
                        price: 155.77,
                        price_breakup: {
                            base_delivery_charge: 127.01,
                            total_gst_amount: 22.86,
                            surge: 5.9,
                            additional_charges: [],
                            items: [
                                {
                                    order_id: dropRef,
                                    total: 155.77,
                                    amount: 127.01,
                                    tax: 22.86,
                                    surge: 5.9,
                                    surge_breakup: {
                                        total_surge_amount: 5.9,
                                        slot_of_day_surge_amount: 5.9
                                    }
                                }
                            ],
                            surge_breakup: {
                                total_surge_amount: 5.9,
                                slot_of_day_surge_amount: 5.9
                            }
                        },
                        eta: {},
                        is_rain: false
                    },
                    error: null
                },
                {
                    network_id: 371,
                    network_name: "Rapido",
                    service: "rapido",
                    pickup_now: true,
                    manifest: false,
                    quote: {
                        price: 164.02,
                        eta: {
                            pickup: null,
                            drop: null
                        },
                        price_breakup: {
                            base_delivery_charge: 134,
                            total_gst_amount: 24.12,
                            surge: 5.9,
                            additional_charges: [],
                            items: [
                                {
                                    order_id: dropRef,
                                    total: 164.02,
                                    amount: 134,
                                    tax: 24.12,
                                    surge: 5.9,
                                    surge_breakup: {
                                        total_surge_amount: 5.9,
                                        slot_of_day_surge_amount: 5.9
                                    }
                                }
                            ],
                            surge_breakup: {
                                total_surge_amount: 5.9,
                                slot_of_day_surge_amount: 5.9
                            }
                        },
                        is_rain: false
                    },
                    error: null
                },
                {
                    network_id: 60,
                    network_name: "Flash by Shadowfax",
                    service: "flash",
                    pickup_now: true,
                    manifest: false,
                    quote: {
                        price: 178.27,
                        distance: distanceMeters,
                        eta: {
                            pickup: null,
                            drop: null
                        },
                        price_breakup: {
                            base_delivery_charge: 172.37,
                            total_gst_amount: 0,
                            surge: 0,
                            additional_charges: [],
                            surge_breakup: {
                                total_surge_amount: 0
                            }
                        },
                        is_rain: false
                    },
                    error: null
                },
                {
                    network_id: 783,
                    network_name: "MagicFleet",
                    service: "magicpin",
                    pickup_now: true,
                    manifest: false,
                    quote: {
                        price: 177,
                        eta: {
                            pickup: null,
                            drop: null
                        },
                        price_breakup: {
                            base_delivery_charge: 145,
                            total_gst_amount: 26.1,
                            surge: 5.9,
                            additional_charges: [],
                            items: [
                                {
                                    order_id: dropRef,
                                    total: 177,
                                    amount: 145,
                                    tax: 26.1,
                                    surge: 5.9,
                                    surge_breakup: {
                                        total_surge_amount: 5.9,
                                        slot_of_day_surge_amount: 5.9
                                    }
                                }
                            ],
                            surge_breakup: {
                                total_surge_amount: 5.9,
                                slot_of_day_surge_amount: 5.9
                            }
                        },
                        is_rain: false
                    },
                    error: null
                }
            ]
        }
    });
});

// Legacy quote endpoint (fallback)
app.post('/v1.0/store/quote', async (req, res) => {
    requestCount++;
    await delay(DELAY_MS);

    res.json({
        success: true,
        data: {
            quote_id: `QUOTE-${uuidv4().substring(0, 8)}`,
            delivery_fee: Math.floor(Math.random() * 50) + 30,
            distance_km: Math.floor(Math.random() * 10) + 1,
            estimated_time_minutes: Math.floor(Math.random() * 30) + 20,
            valid_until: new Date(Date.now() + 10 * 60000).toISOString()
        }
    });
});

// Catch-all for unmatched routes
app.all('*', (req, res) => {
    requestCount++;
    res.status(200).json({
        success: true,
        message: 'Mock endpoint - not specifically implemented',
        path: req.path,
        method: req.method
    });
});

app.listen(PORT, () => {
    console.log(`Mock Pidge API running on port ${PORT}`);
    console.log(`Response delay: ${DELAY_MS}ms`);
});
