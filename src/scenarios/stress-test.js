/**
 * Stress Test - System Breaking Point
 *
 * Push the system to find its limits:
 * - Extreme concurrent users
 * - All operations under heavy load
 * - Find breaking points and bottlenecks
 *
 * Modes:
 * - sanity: Single user, quick validation (~2 min)
 * - load:   Multiple users, full stress test (~15 min)
 *
 * Usage:
 *   ./run-tests.sh stress --restaurant 324672 --mode sanity  # Quick validation
 *   ./run-tests.sh stress --restaurant 324672                # Full stress test
 */

import { sleep, group, check } from 'k6';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';
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
const responseTime = new Trend('response_time');
const errorRate = new Rate('error_rate');
const successRate = new Rate('success_rate');
const timeouts = new Counter('timeouts');
const activeUsers = new Gauge('active_users');
const requestsPerSecond = new Rate('requests_per_second');

const menuResponseTime = new Trend('menu_response_time');
const loginResponseTime = new Trend('login_response_time');
const orderResponseTime = new Trend('order_response_time');
const paymentResponseTime = new Trend('payment_response_time');

const ordersAttempted = new Counter('orders_attempted');
const ordersSucceeded = new Counter('orders_succeeded');
const ordersFailed = new Counter('orders_failed');

// Check if sanity mode
const isSanityMode = CONFIG.USER_MODE === 'sanity';

// User pool
const userPool = generateUserPool(isSanityMode ? 1 : 2000);

// Scenario configurations
const sanityScenario = {
    executor: 'per-vu-iterations',
    vus: 1,
    iterations: 5,  // Test each stress operation once
    maxDuration: '5m',
};

const stressScenario = {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
        { duration: '1m', target: 100 },   // Ramp to 100
        { duration: '2m', target: 200 },   // Increase to 200
        { duration: '2m', target: 300 },   // Increase to 300
        { duration: '3m', target: 500 },   // Peak at 500
        { duration: '3m', target: 500 },   // Sustain peak
        { duration: '2m', target: 300 },   // Scale down
        { duration: '2m', target: 0 },     // Ramp down
    ],
};

export const options = {
    scenarios: {
        stress_test: isSanityMode ? sanityScenario : stressScenario,
    },
    thresholds: {
        // Relaxed thresholds for stress test
        'http_req_duration': ['p(95)<5000', 'p(99)<10000'],
        'http_req_failed': ['rate<0.20'],  // Allow up to 20% failures
        'error_rate': ['rate<0.25'],
        'success_rate': ['rate>0.75'],
        'response_time': ['p(95)<5000'],
    },
};

export default function (data) {
    activeUsers.add(__VU);
    const restaurantId = CONFIG.RESTAURANT_ID;
    const menuData = data?.menuData;

    // Distribute load across different operations
    const action = Math.random();

    if (action < 0.30) {
        // 30% - Menu stress
        stressMenu(restaurantId);
    } else if (action < 0.50) {
        // 20% - Login stress
        stressLogin(restaurantId);
    } else if (action < 0.75) {
        // 25% - Order stress
        stressOrder(restaurantId, menuData);
    } else if (action < 0.90) {
        // 15% - Tracking stress
        stressTracking(data?.orderIds);
    } else {
        // 10% - Mixed operations
        stressMixed();
    }

    sleep(randomSleep(100, 500));
}

function stressMenu(restaurantId) {
    group('Stress: Menu', function () {
        const start = Date.now();

        const res = apiGet(ENDPOINTS.MENU_CATEGORY(restaurantId));
        const duration = Date.now() - start;

        menuResponseTime.add(duration);
        responseTime.add(duration);
        requestsPerSecond.add(1);

        if (res.status === 200) {
            successRate.add(1);
            errorRate.add(0);
        } else {
            successRate.add(0);
            errorRate.add(1);
            if (res.status === 0) timeouts.add(1);
        }
    });
}

function stressLogin(restaurantId) {
    group('Stress: Login', function () {
        const user = getUserFromPool(userPool, __VU);
        const start = Date.now();

        // Request OTP
        const loginDto = generateLoginDto(user.name, user.mobile);
        let res = apiPost(ENDPOINTS.LOGIN_OTP, loginDto);

        if (res.status !== 200) {
            loginResponseTime.add(Date.now() - start);
            responseTime.add(Date.now() - start);
            errorRate.add(1);
            successRate.add(0);
            return;
        }

        // Verify OTP
        const verifyDto = generateVerifyOtpDto(user.mobile, restaurantId, CONFIG.LOAD_TEST_OTP);
        res = apiPost(ENDPOINTS.LOGIN_VERIFY, verifyDto);

        const duration = Date.now() - start;
        loginResponseTime.add(duration);
        responseTime.add(duration);
        requestsPerSecond.add(1);

        if (res.status === 200) {
            successRate.add(1);
            errorRate.add(0);
        } else {
            successRate.add(0);
            errorRate.add(1);
        }
    });
}

function stressOrder(restaurantId, menuData) {
    group('Stress: Order', function () {
        const user = getUserFromPool(userPool, __VU);
        const start = Date.now();
        ordersAttempted.add(1);

        // Quick login
        const loginDto = generateLoginDto(user.name, user.mobile);
        let res = apiPost(ENDPOINTS.LOGIN_OTP, loginDto);

        if (res.status !== 200) {
            ordersFailed.add(1);
            errorRate.add(1);
            return;
        }

        const verifyDto = generateVerifyOtpDto(user.mobile, restaurantId, CONFIG.LOAD_TEST_OTP);
        res = apiPost(ENDPOINTS.LOGIN_VERIFY, verifyDto);

        let customerId = null;
        if (res.status === 200) {
            try {
                const body = JSON.parse(res.body);
                customerId = body.data?.[0]?.id || body.data?.id;
            } catch (e) {}
        }

        if (!customerId) {
            ordersFailed.add(1);
            errorRate.add(1);
            return;
        }

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
        const orderId = extractId(res);

        if (!orderId) {
            ordersFailed.add(1);
            orderResponseTime.add(Date.now() - start);
            errorRate.add(1);
            return;
        }

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
            const verifyPayload = generatePaymentVerifyDto();
            verifyPayload.razorpayOrderId = paymentOrderId;
            res = apiPost(ENDPOINTS.PAYMENT_VERIFY(orderId), verifyPayload);

            if (res.status === 200) {
                ordersSucceeded.add(1);
                successRate.add(1);
                errorRate.add(0);
            } else {
                ordersFailed.add(1);
                errorRate.add(1);
            }
        } else {
            ordersFailed.add(1);
            errorRate.add(1);
        }

        const duration = Date.now() - start;
        orderResponseTime.add(duration);
        paymentResponseTime.add(duration);
        responseTime.add(duration);
        requestsPerSecond.add(1);
    });
}

function stressTracking(orderIds) {
    group('Stress: Tracking', function () {
        const start = Date.now();

        if (orderIds && orderIds.length > 0) {
            const orderId = orderIds[Math.floor(Math.random() * orderIds.length)];
            const res = apiGet(ENDPOINTS.ORDER_GET(orderId));

            responseTime.add(Date.now() - start);
            requestsPerSecond.add(1);

            if (res.status === 200 || res.status === 404) {
                successRate.add(1);
                errorRate.add(0);
            } else {
                successRate.add(0);
                errorRate.add(1);
            }
        } else {
            const res = apiGet(ENDPOINTS.ORDER_LIST);
            responseTime.add(Date.now() - start);
            requestsPerSecond.add(1);

            if (res.status === 200) {
                successRate.add(1);
                errorRate.add(0);
            } else {
                successRate.add(0);
                errorRate.add(1);
            }
        }
    });
}

function stressMixed() {
    group('Stress: Mixed', function () {
        const start = Date.now();
        const ops = [
            () => apiGet(ENDPOINTS.RESTAURANT_LIST),
            () => apiGet(ENDPOINTS.CATEGORY_LIST),
            () => apiGet(ENDPOINTS.ITEM_LIST),
            () => apiGet(ENDPOINTS.CUSTOMER_LIST),
            () => apiGet(ENDPOINTS.HEALTH),
        ];

        const op = ops[Math.floor(Math.random() * ops.length)];
        const res = op();

        responseTime.add(Date.now() - start);
        requestsPerSecond.add(1);

        if (res.status === 200) {
            successRate.add(1);
            errorRate.add(0);
        } else {
            successRate.add(0);
            errorRate.add(1);
            if (res.status === 0) timeouts.add(1);
        }
    });
}

export function setup() {
    console.log('='.repeat(60));
    console.log(`STRESS TEST - ${isSanityMode ? 'SANITY MODE' : 'FINDING SYSTEM BREAKING POINT'}`);
    console.log('='.repeat(60));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'NOT SET!'}`);
    console.log(`Mode: ${isSanityMode ? 'sanity (single user validation)' : 'stress (multi-user)'}`);
    console.log('');
    console.log('Load Distribution:');
    console.log('  30% - Menu operations');
    console.log('  20% - Login operations');
    console.log('  25% - Order + Payment');
    console.log('  15% - Order tracking');
    console.log('  10% - Mixed operations');
    console.log('');
    if (isSanityMode) {
        console.log('VUs: 1, Iterations: 5');
        console.log('Duration: ~2 minutes');
    } else {
        console.log('Load Pattern: 0 → 100 → 200 → 300 → 500 → 500 → 0 VUs');
        console.log('Duration: ~15 minutes');
    }
    console.log('='.repeat(60));

    if (!CONFIG.RESTAURANT_ID) {
        throw new Error('RESTAURANT_ID is required!');
    }

    // Fetch menu data
    const menuData = fetchMenuData(CONFIG.RESTAURANT_ID);

    // Fetch existing orders
    const res = apiGet(ENDPOINTS.ORDER_LIST);
    let orderIds = [];
    if (res.status === 200) {
        try {
            const data = JSON.parse(res.body);
            orderIds = (data.data || []).slice(0, 100).map(o => o.id).filter(Boolean);
        } catch (e) {}
    }

    console.log(`Loaded ${menuData?.items?.length || 0} menu items`);
    console.log(`Found ${orderIds.length} existing orders`);

    return { startTime: Date.now(), menuData, orderIds };
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000 / 60;
    console.log(`\nStress test completed in ${duration.toFixed(1)} minutes`);
}

export function handleSummary(data) {
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
}
