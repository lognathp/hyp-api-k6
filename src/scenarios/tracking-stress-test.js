/**
 * Order Tracking Stress Test - Delivery Tracking APIs Under Heavy Load
 *
 * Simulates users tracking active and completed deliveries:
 * - Order tracking API (/order/track/{orderId})
 * - Delivery status API (/delivery/status/{orderId})
 * - Rider location API (/delivery/rider-location/{orderId})
 *
 * Test Data Requirements:
 * - Orders with status: DELIVERED, OUT_FOR_PICKUP, or OUT_FOR_DELIVERY
 * - Orders must have delivery records with status "fulfilled"
 *
 * Modes:
 * - sanity: Single user, quick validation (~1 min)
 * - load:   Multiple users, full stress test (~5 min)
 *
 * Usage:
 *   ./run-tests.sh tracking-stress --restaurant 324672 --mode sanity  # Quick validation
 *   ./run-tests.sh tracking-stress --restaurant 324672                # Full stress test
 */

import { sleep, group, check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { CONFIG, ENDPOINTS, THRESHOLDS } from '../config.js';
import { apiGet, randomSleep } from '../utils/helpers.js';

// Custom metrics
const trackingSuccessRate = new Rate('tracking_success_rate');
const orderTrackTime = new Trend('order_track_duration');
const deliveryStatusTime = new Trend('delivery_status_duration');
const riderLocationTime = new Trend('rider_location_duration');
const trackingRequests = new Counter('tracking_requests');

// Check if sanity mode
const isSanityMode = CONFIG.USER_MODE === 'sanity';

// Sample order IDs - these should be populated with real order IDs
// In production, you would fetch these dynamically or pass via environment
let sampleOrderIds = [];

// Scenario configurations
const sanityScenario = {
    executor: 'per-vu-iterations',
    vus: 1,
    iterations: 3,  // Test each tracking API once (track, status, location)
    maxDuration: '2m',
};

const stressScenario = {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
        { duration: '30s', target: 50 },   // Ramp up
        { duration: '1m', target:  75 },   // Increase
        { duration: '1m', target: 100 },   // Peak load
        { duration: '1m', target: 100 },   // Sustain peak
        { duration: '1m', target: 75 },   // Scale down
        { duration: '30s', target: 0 },    // Ramp down
    ],
};

export const options = {
    scenarios: {
        tracking_stress: isSanityMode ? sanityScenario : stressScenario,
    },
    thresholds: {
        ...THRESHOLDS,
        'tracking_success_rate': ['rate>0.95'],
        'order_track_duration': ['p(95)<1500'],
        'delivery_status_duration': ['p(95)<1500'],
        'rider_location_duration': ['p(95)<1500'],
    },
};

export default function (data) {
    const orderIds = data?.orderIds || sampleOrderIds;

    if (orderIds.length === 0) {
        console.warn('No trackable orders available. Skipping iteration.');
        sleep(1);
        return;
    }

    // Pick a random order to track
    const orderId = orderIds[Math.floor(Math.random() * orderIds.length)];

    // Simulate user tracking active/completed deliveries
    const action = Math.random();

    if (action < 0.5) {
        // 50% - Track order (most common user action)
        trackOrder(orderId);
    } else if (action < 0.8) {
        // 30% - Get delivery status
        getDeliveryStatus(orderId);
    } else {
        // 20% - Get rider location
        getRiderLocation(orderId);
    }

    sleep(randomSleep(500, 1500));
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
        const start = Date.now();
        const res = apiGet(ENDPOINTS.DELIVERY_RIDER_LOCATION(orderId));
        riderLocationTime.add(Date.now() - start);
        trackingRequests.add(1);

        const success = check(res, {
            'Rider location OK': (r) => r.status === 200 || r.status === 404,
        });
        trackingSuccessRate.add(success ? 1 : 0);
    });
}

export function setup() {
    console.log('='.repeat(60));
    console.log(`TRACKING STRESS TEST - ${isSanityMode ? 'SANITY MODE' : 'STRESS TEST'}`);
    console.log('='.repeat(60));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'Not set'}`);
    console.log(`Mode: ${isSanityMode ? 'sanity (single user validation)' : 'stress (multi-user)'}`);
    if (isSanityMode) {
        console.log('VUs: 1, Iterations: 3');
        console.log('Duration: ~1 minute');
    } else {
        console.log('Load Pattern: 0 → 50 → 100 → 200 → 100 → 0 VUs');
        console.log('Duration: ~5 minutes');
    }
    console.log('='.repeat(60));

    // Fetch orders with delivery-trackable statuses
    console.log('\nFetching trackable orders (DELIVERED, OUT_FOR_PICKUP, OUT_FOR_DELIVERY)...');
    const trackableStatuses = ['DELIVERED', 'OUT_FOR_PICKUP', 'OUT_FOR_DELIVERY'];
    let allOrders = [];

    // Fetch orders for each status
    for (const status of trackableStatuses) {
        const res = apiGet(ENDPOINTS.ORDER_LIST_BY_STATUS(status));
        if (res.status === 200) {
            try {
                const data = JSON.parse(res.body);
                const orders = data.data || [];
                console.log(`  - ${status}: ${orders.length} orders`);
                allOrders = allOrders.concat(orders);
            } catch (e) {
                console.warn(`  - Could not parse ${status} orders`);
            }
        }
    }

    console.log(`\nTotal orders found: ${allOrders.length}`);

    // Filter orders that have fulfilled delivery records
    console.log('Filtering orders with fulfilled delivery records...');
    let validOrderIds = [];

    for (const order of allOrders.slice(0, 150)) {  // Check first 150 orders
        const orderId = order.id || order._id;
        if (!orderId) continue;

        // Check if order has a delivery record
        const deliveryRes = apiGet(ENDPOINTS.DELIVERY_STATUS(orderId));
        if (deliveryRes.status === 200) {
            try {
                const deliveryData = JSON.parse(deliveryRes.body);
                const deliveryStatus = deliveryData.data[0]?.status;
            
                // Check if delivery is fulfilled
                if (deliveryStatus && (deliveryStatus.toLowerCase() === 'fulfilled' || deliveryStatus.toLowerCase() === 'completed')) {
                    validOrderIds.push(orderId);
                }
            } catch (e) {
                // Skip orders with invalid delivery data
            }
        }

        // Limit to 100 valid orders for performance
        if (validOrderIds.length >= 100) break;
    }

    console.log(`Found ${validOrderIds.length} orders with fulfilled deliveries`);

    if (validOrderIds.length === 0) {
        console.warn('\  WARNING: No valid trackable orders found!');
        console.warn('Please ensure you have orders with:');
        console.warn('  1. Status: DELIVERED, OUT_FOR_PICKUP, or OUT_FOR_DELIVERY');
        console.warn('  2. Delivery record with status: fulfilled');
        console.warn('\nTest will skip iterations until valid orders are available.');
    }

    return { startTime: Date.now(), orderIds: validOrderIds };
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
