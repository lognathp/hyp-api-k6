/**
 * Load Test - Mixed Realistic Traffic Simulation
 *
 * Simulates realistic mixed traffic:
 * - 40% Menu browsing
 * - 25% User journey (browse → login → order → payment)
 * - 20% Order tracking
 * - 15% Other operations (restaurants, customers, etc.)
 *
 * Duration: ~20 minutes
 * VUs: Ramping 0 → 50 → 100 → 100 → 50 → 0
 *
 * Usage: ./run-tests.sh load --restaurant 324672
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

// User pool
const userPool = generateUserPool(1000);

export const options = {
    scenarios: {
        load_test: {
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
        },
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
        const start = Date.now();
        let success = true;

        // Fetch menu
        let res = apiGet(ENDPOINTS.MENU_CATEGORY(restaurantId));
        if (res.status !== 200) success = false;
        menuRequests.add(1);

        sleep(randomSleep(200, 500));

        // Fetch categories
        res = apiGet(ENDPOINTS.CATEGORY_LIST);
        if (res.status !== 200) success = false;
        menuRequests.add(1);

        sleep(randomSleep(100, 300));

        // Fetch addons
        res = apiGet(ENDPOINTS.ADDON_GROUP_LIST);
        if (res.status !== 200) success = false;
        menuRequests.add(1);

        menuTime.add(Date.now() - start);
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

            let res = apiGet(ENDPOINTS.ORDER_GET(orderId));
            if (res.status !== 200 && res.status !== 404) success = false;
            trackingRequests.add(1);

            sleep(randomSleep(100, 300));

            res = apiGet(ENDPOINTS.ORDER_TRACK(orderId));
            if (res.status !== 200 && res.status !== 404) success = false;
            trackingRequests.add(1);
        } else {
            // Just fetch order list
            const res = apiGet(ENDPOINTS.ORDER_LIST);
            if (res.status !== 200) success = false;
            trackingRequests.add(1);
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
    console.log('LOAD TEST - Mixed Realistic Traffic');
    console.log('='.repeat(60));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'NOT SET!'}`);
    console.log('');
    console.log('Traffic Mix:');
    console.log('  40% - Menu browsing');
    console.log('  25% - Order flow (login → order → payment)');
    console.log('  20% - Order tracking');
    console.log('  15% - Other operations');
    console.log('');
    console.log('Load Pattern: 0 → 50 → 100 → 100 → 50 → 0 VUs');
    console.log('Duration: ~20 minutes');
    console.log('='.repeat(60));

    if (!CONFIG.RESTAURANT_ID) {
        throw new Error('RESTAURANT_ID is required!');
    }

    // Fetch menu data
    const menuData = fetchMenuData(CONFIG.RESTAURANT_ID);

    // Fetch existing orders for tracking
    const res = apiGet(ENDPOINTS.ORDER_LIST);
    let orderIds = [];
    if (res.status === 200) {
        try {
            const data = JSON.parse(res.body);
            orderIds = (data.data || []).slice(0, 100).map(o => o.id).filter(Boolean);
        } catch (e) {}
    }

    console.log(`Loaded ${menuData?.items?.length || 0} menu items`);
    console.log(`Found ${orderIds.length} existing orders for tracking`);

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
