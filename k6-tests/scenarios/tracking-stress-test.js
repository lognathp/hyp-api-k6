/**
 * Order Tracking Stress Test - Order Status API Under Heavy Load
 *
 * Simulates users constantly checking order status:
 * - Order tracking API
 * - Order status API
 * - Delivery status API
 *
 * Requires existing orders in the system for realistic testing.
 *
 * Duration: ~5 minutes
 * VUs: Ramping 0 → 100 → 200 → 100 → 0
 *
 * Usage: ./scripts/run-tests.sh tracking-stress --restaurant 324672
 */

import { sleep, group, check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { CONFIG, ENDPOINTS, THRESHOLDS } from '../config.js';
import { apiGet, randomSleep } from '../utils/helpers.js';

// Custom metrics
const trackingSuccessRate = new Rate('tracking_success_rate');
const orderStatusTime = new Trend('order_status_duration');
const orderTrackTime = new Trend('order_track_duration');
const deliveryStatusTime = new Trend('delivery_status_duration');
const trackingRequests = new Counter('tracking_requests');

// Sample order IDs - these should be populated with real order IDs
// In production, you would fetch these dynamically or pass via environment
let sampleOrderIds = [];

export const options = {
    scenarios: {
        tracking_stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 50 },   // Ramp up
                { duration: '1m', target: 100 },   // Increase
                { duration: '1m', target: 200 },   // Peak load
                { duration: '1m', target: 200 },   // Sustain peak
                { duration: '1m', target: 100 },   // Scale down
                { duration: '30s', target: 0 },    // Ramp down
            ],
        },
    },
    thresholds: {
        ...THRESHOLDS,
        'tracking_success_rate': ['rate>0.95'],
        'order_status_duration': ['p(95)<1500'],
        'order_track_duration': ['p(95)<1500'],
        'delivery_status_duration': ['p(95)<1500'],
    },
};

export default function (data) {
    const orderIds = data?.orderIds || sampleOrderIds;

    if (orderIds.length === 0) {
        // If no specific orders, just hit the order list endpoint
        group('Order List', function () {
            const start = Date.now();
            const res = apiGet(ENDPOINTS.ORDER_LIST);
            orderStatusTime.add(Date.now() - start);
            trackingRequests.add(1);

            const success = check(res, {
                'Order list OK': (r) => r.status === 200,
            });
            trackingSuccessRate.add(success ? 1 : 0);
        });

        sleep(randomSleep(300, 800));
        return;
    }

    // Pick a random order to track
    const orderId = orderIds[Math.floor(Math.random() * orderIds.length)];

    // Simulate user checking order status
    const action = Math.random();

    if (action < 0.4) {
        // 40% - Get order status
        getOrderStatus(orderId);
    } else if (action < 0.7) {
        // 30% - Track order
        trackOrder(orderId);
    } else if (action < 0.9) {
        // 20% - Get delivery status
        getDeliveryStatus(orderId);
    } else {
        // 10% - Get rider location
        getRiderLocation(orderId);
    }

    sleep(randomSleep(500, 1500));
}

function getOrderStatus(orderId) {
    group('Order Status', function () {
        const start = Date.now();
        const res = apiGet(ENDPOINTS.ORDER_GET(orderId));
        orderStatusTime.add(Date.now() - start);
        trackingRequests.add(1);

        const success = check(res, {
            'Order status OK': (r) => r.status === 200 || r.status === 404,
        });
        trackingSuccessRate.add(success ? 1 : 0);

        if (res.status === 200) {
            try {
                const data = JSON.parse(res.body);
                const status = data.data?.[0]?.status || data.data?.status;
                // console.log(`Order ${orderId}: ${status}`);
            } catch (e) {}
        }
    });
}

function trackOrder(orderId) {
    group('Order Track', function () {
        const start = Date.now();
        const res = apiGet(ENDPOINTS.ORDER_TRACK(orderId));
        orderTrackTime.add(Date.now() - start);
        trackingRequests.add(1);

        const success = check(res, {
            'Order track OK': (r) => r.status === 200 || r.status === 404,
        });
        trackingSuccessRate.add(success ? 1 : 0);
    });
}

function getDeliveryStatus(orderId) {
    group('Delivery Status', function () {
        const start = Date.now();
        const res = apiGet(ENDPOINTS.DELIVERY_STATUS(orderId));
        deliveryStatusTime.add(Date.now() - start);
        trackingRequests.add(1);

        const success = check(res, {
            'Delivery status OK': (r) => r.status === 200 || r.status === 404,
        });
        trackingSuccessRate.add(success ? 1 : 0);
    });
}

function getRiderLocation(orderId) {
    group('Rider Location', function () {
        const res = apiGet(ENDPOINTS.DELIVERY_RIDER_LOCATION(orderId));
        trackingRequests.add(1);

        const success = check(res, {
            'Rider location OK': (r) => r.status === 200 || r.status === 404,
        });
        trackingSuccessRate.add(success ? 1 : 0);
    });
}

export function setup() {
    console.log('='.repeat(60));
    console.log('TRACKING STRESS TEST - Order Status API Under Heavy Load');
    console.log('='.repeat(60));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'Not set'}`);
    console.log('Load Pattern: 0 → 100 → 200 → 100 → 0 VUs');
    console.log('Duration: ~5 minutes');
    console.log('='.repeat(60));

    // Fetch existing orders to track
    console.log('\nFetching existing orders...');
    const res = apiGet(ENDPOINTS.ORDER_LIST);
    let orderIds = [];

    if (res.status === 200) {
        try {
            const data = JSON.parse(res.body);
            const orders = data.data || [];
            orderIds = orders.slice(0, 100).map(o => o.id || o._id).filter(Boolean);
            console.log(`Found ${orderIds.length} orders to track`);
        } catch (e) {
            console.warn('Could not parse orders');
        }
    }

    if (orderIds.length === 0) {
        console.warn('No existing orders found. Will use order list endpoint.');
    }

    return { startTime: Date.now(), orderIds };
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000 / 60;
    console.log(`\nTracking stress test completed in ${duration.toFixed(1)} minutes`);
}

export function handleSummary(data) {
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
}
