/**
 * Load Test - Mixed Realistic Traffic Simulation
 *
 * Simulates realistic mixed traffic:
 * - 40% Menu browsing
 * - 25% User journey (browse → login → order → payment)
 * - 20% Order tracking
 * - 15% Other operations (restaurants, customers, etc.)
 *
 * Modes:
 * - sanity: Single user, quick validation (~2 min)
 * - load:   Multiple users, full load test (~20 min)
 *
 * Usage:
 *   ./run-tests.sh load --restaurant 324672 --mode sanity  # Quick validation
 *   ./run-tests.sh load --restaurant 324672                # Full load test
 */

import { sleep, group, check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { CONFIG, ENDPOINTS, THRESHOLDS } from '../config.js';
import { apiGet, apiPost, extractId, randomSleep } from '../utils/helpers.js';
import {
    generateLoginDto,
    generateVerifyOtpDto,
    generatePaymentVerifyDto,
    generateUserPool,
    getUserFromPool,
    fetchMenuData,
    generateDynamicOrderDto,
    generateOrderDto,
} from '../data/test-data.js';

// Custom metrics
const overallSuccessRate = new Rate('overall_success_rate');
const menuSuccessRate = new Rate('menu_success_rate');
const orderSuccessRate = new Rate('order_success_rate');
const trackingSuccessRate = new Rate('tracking_success_rate');

const menuTime = new Trend('menu_duration');
const orderFlowTime = new Trend('order_flow_duration');
const trackingTime = new Trend('tracking_duration');

const menuRequests = new Counter('menu_requests');
const orderRequests = new Counter('order_requests');
const trackingRequests = new Counter('tracking_requests');
const ordersCreated = new Counter('orders_created');

// Check if sanity mode
const isSanityMode = CONFIG.USER_MODE === 'sanity';

// User pool
const userPool = generateUserPool(isSanityMode ? 1 : 1000);

// Scenario configurations
const sanityScenario = {
    executor: 'per-vu-iterations',
    vus: 1,
    iterations: 4,  // Test each traffic type once
    maxDuration: '5m',
};

const loadScenario = {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
        { duration: '2m', target: 25 },    // Ramp up
        { duration: '3m', target: 50 },    // Increase
        { duration: '5m', target: 100 },   // Peak
        { duration: '5m', target: 100 },   // Sustain
        { duration: '3m', target: 50 },    // Scale down
        { duration: '2m', target: 0 },     // Ramp down
    ],
};

export const options = {
    scenarios: {
        load_test: isSanityMode ? sanityScenario : loadScenario,
    },
    thresholds: {
        ...THRESHOLDS,
        'overall_success_rate': ['rate>0.90'],
        'menu_success_rate': ['rate>0.95'],
        'order_success_rate': ['rate>0.85'],
        'menu_duration': ['p(95)<2000'],
        'order_flow_duration': ['p(95)<15000'],
    },
};

export default function (data) {
    const restaurantId = CONFIG.RESTAURANT_ID;
    const menuData = data?.menuData;
    const action = Math.random();

    if (action < 0.40) {
        // 40% - Menu browsing
        browseMenu(restaurantId);
    } else if (action < 0.65) {
        // 25% - Complete order flow
        completeOrderFlow(restaurantId, menuData);
    } else if (action < 0.85) {
        // 20% - Order tracking
        trackOrders(data?.orderIds);
    } else {
        // 15% - Other operations
        otherOperations();
    }

    sleep(randomSleep(500, 1500));
}

function browseMenu(restaurantId) {
    group('Menu Browse', function () {
        let apiTime = 0;
        let success = true;

        // Fetch menu
        let start = Date.now();
        let res = apiGet(ENDPOINTS.MENU_CATEGORY(restaurantId));
        apiTime += Date.now() - start;
        if (res.status !== 200) success = false;
        menuRequests.add(1);

        sleep(randomSleep(200, 500));

        // Fetch categories
        start = Date.now();
        res = apiGet(ENDPOINTS.CATEGORY_LIST);
        apiTime += Date.now() - start;
        if (res.status !== 200) success = false;
        menuRequests.add(1);

        sleep(randomSleep(100, 300));

        // Fetch addons
        start = Date.now();
        res = apiGet(ENDPOINTS.ADDON_GROUP_LIST);
        apiTime += Date.now() - start;
        if (res.status !== 200) success = false;
        menuRequests.add(1);

        menuTime.add(apiTime / 3);
        menuSuccessRate.add(success ? 1 : 0);
        overallSuccessRate.add(success ? 1 : 0);
    });
}

function completeOrderFlow(restaurantId, menuData) {
    group('Order Flow', function () {
        const start = Date.now();
        const user = getUserFromPool(userPool, __VU);
        let customerId = null;
        let orderId = null;
        let success = false;

        // Login
        const loginDto = generateLoginDto(user.name, user.mobile);
        let res = apiPost(ENDPOINTS.LOGIN_OTP, loginDto);

        if (res.status === 200) {
            sleep(randomSleep(100, 200));
            const verifyDto = generateVerifyOtpDto(user.mobile, restaurantId, CONFIG.LOAD_TEST_OTP);
            res = apiPost(ENDPOINTS.LOGIN_VERIFY, verifyDto);

            if (res.status === 200) {
                try {
                    const body = JSON.parse(res.body);
                    customerId = body.data?.[0]?.id || body.data?.id;
                } catch (e) {}
            }
        }

        if (!customerId) {
            orderFlowTime.add(Date.now() - start);
            orderSuccessRate.add(0);
            overallSuccessRate.add(0);
            return;
        }

        sleep(randomSleep(200, 400));

        // Create order
        let orderPayload;
        if (menuData && menuData.items && menuData.items.length > 0) {
            orderPayload = generateDynamicOrderDto(restaurantId, customerId, menuData, {
                paymentType: 'CREDIT',
                orderType: '1',
            });
        } else {
            orderPayload = generateOrderDto(restaurantId, customerId, {
                paymentType: 'CREDIT',
                orderType: '1',
            });
        }

        res = apiPost(ENDPOINTS.ORDER_CREATE, orderPayload);
        orderRequests.add(1);

        if (res.status === 200) {
            orderId = extractId(res);
        }

        if (!orderId) {
            orderFlowTime.add(Date.now() - start);
            orderSuccessRate.add(0);
            overallSuccessRate.add(0);
            return;
        }

        ordersCreated.add(1);
        sleep(randomSleep(200, 400));

        // Payment
        res = apiPost(ENDPOINTS.PAYMENT_CREATE(orderId), {});
        let paymentOrderId = null;

        if (res.status === 200) {
            try {
                const body = JSON.parse(res.body);
                paymentOrderId = body.data?.[0]?.paymentOrderId;
            } catch (e) {}
        }

        if (paymentOrderId) {
            sleep(randomSleep(100, 200));
            const verifyPayload = generatePaymentVerifyDto();
            verifyPayload.razorpayOrderId = paymentOrderId;
            res = apiPost(ENDPOINTS.PAYMENT_VERIFY(orderId), verifyPayload);

            if (res.status === 200) {
                success = true;
            }
        }

        orderFlowTime.add(Date.now() - start);
        orderSuccessRate.add(success ? 1 : 0);
        overallSuccessRate.add(success ? 1 : 0);
    });
}

function trackOrders(orderIds) {
    group('Order Tracking', function () {
        const start = Date.now();
        let success = true;

        if (orderIds && orderIds.length > 0) {
            const orderId = orderIds[Math.floor(Math.random() * orderIds.length)];

            // Simulate user tracking pattern (same as tracking-stress-test)
            const action = Math.random();

            if (action < 0.5) {
                // 50% - Track order (most common)
                const res = apiGet(ENDPOINTS.ORDER_TRACK(orderId));
                if (res.status !== 200 && res.status !== 404) success = false;
                trackingRequests.add(1);
            } else if (action < 0.8) {
                // 30% - Delivery status
                const res = apiGet(ENDPOINTS.DELIVERY_STATUS(orderId));
                if (res.status !== 200 && res.status !== 404) success = false;
                trackingRequests.add(1);
            } else {
                // 20% - Rider location
                const res = apiGet(ENDPOINTS.DELIVERY_RIDER_LOCATION(orderId));
                if (res.status !== 200 && res.status !== 404) success = false;
                trackingRequests.add(1);
            }
        } else {
            console.warn('No trackable orders available for tracking flow.');
            success = false;
        }

        trackingTime.add(Date.now() - start);
        trackingSuccessRate.add(success ? 1 : 0);
        overallSuccessRate.add(success ? 1 : 0);
    });
}

function otherOperations() {
    group('Other Operations', function () {
        const ops = [
            () => apiGet(ENDPOINTS.RESTAURANT_LIST),
            () => apiGet(ENDPOINTS.CUSTOMER_LIST),
            () => apiGet(ENDPOINTS.OFFER_LIST),
            () => apiGet(ENDPOINTS.FEE_LIST),
            () => apiGet(ENDPOINTS.ORDER_TYPE_LIST),
        ];

        const op = ops[Math.floor(Math.random() * ops.length)];
        const res = op();
        overallSuccessRate.add(res.status === 200 ? 1 : 0);
    });
}

export function setup() {
    console.log('='.repeat(60));
    console.log(`LOAD TEST - ${isSanityMode ? 'SANITY MODE' : 'MIXED REALISTIC TRAFFIC'}`);
    console.log('='.repeat(60));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'NOT SET!'}`);
    console.log(`Mode: ${isSanityMode ? 'sanity (single user validation)' : 'load (multi-user)'}`);
    console.log('');
    console.log('Traffic Mix:');
    console.log('  40% - Menu browsing');
    console.log('  25% - Order flow (login → order → payment)');
    console.log('  20% - Order tracking');
    console.log('  15% - Other operations');
    console.log('');
    if (isSanityMode) {
        console.log('VUs: 1, Iterations: 4');
        console.log('Duration: ~2 minutes');
    } else {
        console.log('Load Pattern: 0 → 25 → 50 → 100 → 100 → 50 → 0 VUs');
        console.log('Duration: ~20 minutes');
    }
    console.log('='.repeat(60));

    if (!CONFIG.RESTAURANT_ID) {
        throw new Error('RESTAURANT_ID is required!');
    }

    // Fetch menu data
    const menuData = fetchMenuData(CONFIG.RESTAURANT_ID);

    // Fetch trackable orders (same approach as tracking-stress-test)
    console.log('\nFetching trackable orders (DELIVERED, OUT_FOR_PICKUP, OUT_FOR_DELIVERY)...');
    const trackableStatuses = ['DELIVERED', 'OUT_FOR_PICKUP', 'OUT_FOR_DELIVERY'];
    let allOrders = [];

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

    console.log(`Total orders found: ${allOrders.length}`);

    // Filter orders that have fulfilled delivery records
    console.log('Filtering orders with fulfilled delivery records...');
    let orderIds = [];

    for (const order of allOrders.slice(0, 150)) {
        const orderId = order.id || order._id;
        if (!orderId) continue;

        const deliveryRes = apiGet(ENDPOINTS.DELIVERY_STATUS(orderId));
        if (deliveryRes.status === 200) {
            try {
                const deliveryData = JSON.parse(deliveryRes.body);
                const deliveryStatus = deliveryData.data[0]?.status;

                if (deliveryStatus && (deliveryStatus.toLowerCase() === 'fulfilled' || deliveryStatus.toLowerCase() === 'completed')) {
                    orderIds.push(orderId);
                }
            } catch (e) {
                // Skip orders with invalid delivery data
            }
        }

        if (orderIds.length >= 100) break;
    }

    console.log(`Loaded ${menuData?.items?.length || 0} menu items`);
    console.log(`Found ${orderIds.length} orders with fulfilled deliveries for tracking`);

    return { startTime: Date.now(), menuData, orderIds };
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000 / 60;
    console.log(`\nLoad test completed in ${duration.toFixed(1)} minutes`);
}

export function handleSummary(data) {
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
}
