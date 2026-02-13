/**
 * Order Creation Stress Test - Order Creation Under Heavy Load
 *
 * Tests order creation flow:
 * - Login
 * - Fetch menu
 * - Create order (with online payment - CREDIT)
 * - Create payment
 * - Verify payment
 *
 * Modes:
 * - sanity: Single user, quick validation (~2 min)
 * - load:   Multiple users, full stress test (~5 min)
 *
 * Usage:
 *   ./run-tests.sh order-stress --restaurant 324672 --mode sanity  # Quick validation
 *   ./run-tests.sh order-stress --restaurant 324672                # Full stress test
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
const orderSuccessRate = new Rate('order_success_rate');
const paymentSuccessRate = new Rate('payment_success_rate');
const orderCreateTime = new Trend('order_create_duration');
const paymentCreateTime = new Trend('payment_create_duration');
const paymentVerifyTime = new Trend('payment_verify_duration');
const totalOrderFlowTime = new Trend('total_order_flow_duration');
const ordersCreated = new Counter('orders_created');
const ordersFailed = new Counter('orders_failed');

// Check if sanity mode
const isSanityMode = CONFIG.USER_MODE === 'sanity';

// Generate user pool
const userPool = generateUserPool(isSanityMode ? 1 : 1000);

// Scenario configurations
const sanityScenario = {
    executor: 'per-vu-iterations',
    vus: 1,
    iterations: 1,
    maxDuration: '5m',
};

const stressScenario = {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
        { duration: '30s', target: 25 },   // Ramp up
        { duration: '1m', target: 50 },    // Increase
        { duration: '1m', target: 100 },   // Peak load
        { duration: '1m', target: 100 },   // Sustain peak
        { duration: '1m', target: 50 },    // Scale down
        { duration: '30s', target: 0 },    // Ramp down
    ],
};

export const options = {
    scenarios: {
        order_stress: isSanityMode ? sanityScenario : stressScenario,
    },
    thresholds: {
        ...THRESHOLDS,
        'order_success_rate': ['rate>0.90'],
        'payment_success_rate': ['rate>0.90'],
        'order_create_duration': ['p(95)<3000'],
        'payment_create_duration': ['p(95)<2000'],
        'payment_verify_duration': ['p(95)<2000'],
        'total_order_flow_duration': ['p(95)<8000'],
    },
};

export default function (data) {
    const restaurantId = CONFIG.RESTAURANT_ID;
    const menuData = data?.menuData;
    const user = getUserFromPool(userPool, __VU);

    const flowStart = Date.now();
    let customerId = null;
    let orderId = null;
    let orderSuccess = false;

    // Step 1: Login
    group('1. Login', function () {
        const loginDto = generateLoginDto(user.name, user.mobile);
        let res = apiPost(ENDPOINTS.LOGIN_OTP, loginDto);

        if (res.status !== 200) {
            console.warn(`OTP request failed: ${res.status}`);
            return;
        }

        sleep(randomSleep(100, 200));

        const verifyDto = generateVerifyOtpDto(user.mobile, restaurantId, CONFIG.LOAD_TEST_OTP);
        res = apiPost(ENDPOINTS.LOGIN_VERIFY, verifyDto);

        const success = check(res, {
            'Login successful': (r) => r.status === 200,
        });

        if (success) {
            try {
                const body = JSON.parse(res.body);
                customerId = body.data?.[0]?.id || body.data?.id;
            } catch (e) {}
        }
    });

    if (!customerId) {
        ordersFailed.add(1);
        orderSuccessRate.add(0);
        totalOrderFlowTime.add(Date.now() - flowStart);
        return;
    }

    sleep(randomSleep(200, 400));

    // Step 2: Browse Menu (quick)
    group('2. Browse Menu', function () {
        if (restaurantId) {
            apiGet(ENDPOINTS.MENU_CATEGORY(restaurantId));
        }
        apiGet(ENDPOINTS.ADDON_GROUP_LIST);
    });

    sleep(randomSleep(200, 400));

    // Step 3: Create Order
    group('3. Create Order', function () {
        const start = Date.now();

        // Generate order with online payment
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

        const res = apiPost(ENDPOINTS.ORDER_CREATE, orderPayload);
        orderCreateTime.add(Date.now() - start);

        const success = check(res, {
            'Order created': (r) => r.status === 200,
            'Order ID received': (r) => {
                orderId = extractId(r);
                return !!orderId;
            },
        });

        if (success) {
            ordersCreated.add(1);
        } else {
            console.warn(`Order creation failed: ${res.status}`);
            ordersFailed.add(1);
        }

        orderSuccessRate.add(success ? 1 : 0);
    });

    if (!orderId) {
        totalOrderFlowTime.add(Date.now() - flowStart);
        return;
    }

    sleep(randomSleep(200, 400));

    // Step 4: Payment Flow
group('4. Payment', function () {
    let paymentOrderId = null;

    // -----------------------
    // Create Payment
    // -----------------------
    const createStart = Date.now();

    let res = apiPost(ENDPOINTS.PAYMENT_CREATE(orderId), {});
    const createDuration = Date.now() - createStart;
    paymentCreateTime.add(createDuration);

    let createSuccess = check(res, {
        'Payment created': (r) => r.status === 200,
    });

    if (createSuccess) {
        try {
            const body = JSON.parse(res.body);
            paymentOrderId = body.data?.[0]?.paymentOrderId;
        } catch (e) {}
    }

    if (!paymentOrderId) {
        paymentSuccessRate.add(0);
        return;
    }

    sleep(randomSleep(100, 200));

    // -----------------------
    // Verify Payment
    // -----------------------
    const verifyStart = Date.now();

    const verifyPayload = generatePaymentVerifyDto();
    verifyPayload.razorpayOrderId = paymentOrderId;

    res = apiPost(ENDPOINTS.PAYMENT_VERIFY(orderId), verifyPayload);

    const verifyDuration = Date.now() - verifyStart;
    paymentVerifyTime.add(verifyDuration);

    const verifySuccess = check(res, {
        'Payment verified': (r) => r.status === 200,
    });

    paymentSuccessRate.add(verifySuccess ? 1 : 0);

    if (verifySuccess) {
        orderSuccess = true;
    }
});

    totalOrderFlowTime.add(Date.now() - flowStart);

    if (orderSuccess) {
        console.log(`Order ${orderId} created and paid for ${user.mobile}`);
    }

    sleep(randomSleep(500, 1000));
}

export function setup() {
    console.log('='.repeat(60));
    console.log(`ORDER STRESS TEST - ${isSanityMode ? 'SANITY MODE' : 'STRESS TEST'}`);
    console.log('='.repeat(60));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'NOT SET!'}`);
    console.log(`Mode: ${isSanityMode ? 'sanity (single user validation)' : 'stress (multi-user)'}`);
    console.log(`User Pool: ${userPool.length} users`);
    if (isSanityMode) {
        console.log('VUs: 1 (single iteration)');
        console.log('Duration: ~2 minutes');
    } else {
        console.log('Load Pattern: 0 → 25 → 50 → 100 → 50 → 0 VUs');
        console.log('Duration: ~5 minutes');
    }
    console.log('='.repeat(60));

    if (!CONFIG.RESTAURANT_ID) {
        throw new Error('RESTAURANT_ID is required! Use --env RESTAURANT_ID=xxx');
    }

    // Fetch menu data
    console.log('\nFetching menu data...');
    const menuData = fetchMenuData(CONFIG.RESTAURANT_ID);

    if (menuData) {
        console.log(`Loaded ${menuData.items?.length || 0} items`);
    } else {
        console.warn('Using static menu data');
    }

    return { startTime: Date.now(), menuData };
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000 / 60;
    console.log(`\nOrder stress test completed in ${duration.toFixed(1)} minutes`);
}

export function handleSummary(data) {
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
}
