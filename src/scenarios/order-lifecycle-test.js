/**
 * Order Lifecycle Test - Complete Backend Flow
 *
 * Full order lifecycle including all backend operations:
 *
 * Flow:
 * 1. Browse Menu → View Items & Addons
 * 2. Login (OTP Request → Verify)
 * 3. Get Delivery Quote
 * 4. Create Order
 * 5. Create Payment
 * 6. Verify Payment
 * 7. POS Callback (ACCEPTED)
 * 8. POS Callback (READY_FOR_DELIVERY)
 * 9. Delivery Callbacks: CREATED → OUT_FOR_PICKUP → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
 * 10. User Tracking (verify delivered)
 *
 * Duration: ~15 minutes (single mode) or configurable (multi mode)
 * VUs: Configurable
 *
 * Usage:
 *   ./run-tests.sh lifecycle --restaurant 324672
 *   ./run-tests.sh lifecycle --restaurant 324672 --mode multi --orders 100
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
    generateOrderStatusUpdate,
    generateDeliveryCallback,
    ORDER_LIFECYCLE,
    DELIVERY_STATUS_SEQUENCE,
    fetchMenuData,
    generateDynamicOrderDto,
    generateOrderDto,
} from '../data/test-data.js';

// Custom metrics
const lifecycleSuccessRate = new Rate('lifecycle_success_rate');
const loginSuccessRate = new Rate('login_success_rate');
const orderSuccessRate = new Rate('order_success_rate');
const paymentSuccessRate = new Rate('payment_success_rate');
const posSuccessRate = new Rate('pos_success_rate');
const deliverySuccessRate = new Rate('delivery_success_rate');

const menuBrowseTime = new Trend('menu_browse_duration');
const loginTime = new Trend('login_duration');
const orderTime = new Trend('order_duration');
const paymentTime = new Trend('payment_duration');
const posTime = new Trend('pos_duration');
const deliveryTime = new Trend('delivery_duration');
const trackingTime = new Trend('tracking_duration');
const totalLifecycleTime = new Trend('total_lifecycle_duration');

const ordersCompleted = new Counter('orders_completed');
const ordersDelivered = new Counter('orders_delivered');

// Mode configuration
const isMultiUserMode = CONFIG.USER_MODE === 'multi';
const userCount = CONFIG.USER_COUNT;
const orderCount = CONFIG.ORDER_COUNT;

// Generate user pool
const userPool = generateUserPool(userCount);

export const options = {
    scenarios: {
        order_lifecycle: isMultiUserMode ? {
            executor: 'shared-iterations',
            vus: Math.min(50, orderCount),
            iterations: orderCount,
            maxDuration: '60m',
        } : {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '1m', target: 10 },
                { duration: '3m', target: 20 },
                { duration: '5m', target: 30 },
                { duration: '3m', target: 20 },
                { duration: '2m', target: 10 },
                { duration: '1m', target: 0 },
            ],
        },
    },
    thresholds: {
        ...THRESHOLDS,
        'lifecycle_success_rate': ['rate>0.80'],
        'login_success_rate': ['rate>0.95'],
        'order_success_rate': ['rate>0.90'],
        'payment_success_rate': ['rate>0.90'],
        'pos_success_rate': ['rate>0.90'],
        'delivery_success_rate': ['rate>0.85'],
        'total_lifecycle_duration': ['p(95)<45000'],
    },
};

export default function (data) {
    const restaurantId = CONFIG.RESTAURANT_ID;
    const menuData = data?.menuData;
    const user = getUserFromPool(userPool, __VU);

    const lifecycleStart = Date.now();
    let lifecycleSuccess = false;
    let customerId = null;
    let orderId = null;
    let menuSharingCode = null;
    let paymentOrderId = null;

    // ========================================
    // PHASE 1: BROWSE MENU
    // ========================================
    group('Phase 1: Browse Menu', function () {
        const start = Date.now();

        // Fetch menu
        let res = apiGet(ENDPOINTS.MENU_CATEGORY(restaurantId));
        check(res, { 'Menu loaded': (r) => r.status === 200 });

        sleep(randomSleep(300, 600));

        // Fetch addons
        res = apiGet(ENDPOINTS.ADDON_GROUP_LIST);
        check(res, { 'Addons loaded': (r) => r.status === 200 });

        menuBrowseTime.add(Date.now() - start);
    });

    sleep(randomSleep(500, 1000));

    // ========================================
    // PHASE 2: LOGIN
    // ========================================
    group('Phase 2: Login', function () {
        const start = Date.now();

        // Request OTP
        const loginDto = generateLoginDto(user.name, user.mobile);
        let res = apiPost(ENDPOINTS.LOGIN_OTP, loginDto);

        if (res.status !== 200) {
            loginSuccessRate.add(0);
            loginTime.add(Date.now() - start);
            return;
        }

        sleep(randomSleep(100, 200));

        // Verify OTP
        const verifyDto = generateVerifyOtpDto(user.mobile, restaurantId, CONFIG.LOAD_TEST_OTP);
        res = apiPost(ENDPOINTS.LOGIN_VERIFY, verifyDto);

        const success = check(res, {
            'Login successful': (r) => r.status === 200,
            'Customer ID received': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    customerId = body.data?.[0]?.id || body.data?.id;
                    return !!customerId;
                } catch (e) { return false; }
            },
        });

        loginSuccessRate.add(success ? 1 : 0);
        loginTime.add(Date.now() - start);
    });

    if (!customerId) {
        lifecycleSuccessRate.add(0);
        totalLifecycleTime.add(Date.now() - lifecycleStart);
        return;
    }

    sleep(randomSleep(200, 400));

    // ========================================
    // PHASE 3: GET DELIVERY QUOTE
    // ========================================
    group('Phase 3: Delivery Quote', function () {
        const res = apiGet(`${ENDPOINTS.DELIVERY_QUOTE(restaurantId)}?addressId=106335`);
        check(res, { 'Quote received': (r) => r.status === 200 || r.status === 404 });
    });

    sleep(randomSleep(200, 400));

    // ========================================
    // PHASE 4: CREATE ORDER
    // ========================================
    group('Phase 4: Create Order', function () {
        const start = Date.now();

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

        const success = check(res, {
            'Order created': (r) => r.status === 200,
        });

        if (success) {
            try {
                const body = JSON.parse(res.body);
                orderId = body.data?.[0]?.id || body.data?.id;
                menuSharingCode = body.data?.[0]?.menuSharingCode || body.data?.menuSharingCode;
            } catch (e) {
                orderId = extractId(res);
            }
            ordersCompleted.add(1);
        }

        orderSuccessRate.add(success && orderId ? 1 : 0);
        orderTime.add(Date.now() - start);
    });

    if (!orderId) {
        lifecycleSuccessRate.add(0);
        totalLifecycleTime.add(Date.now() - lifecycleStart);
        return;
    }

    sleep(randomSleep(200, 400));

    // ========================================
    // PHASE 5: CREATE PAYMENT
    // ========================================
    group('Phase 5: Create Payment', function () {
        const start = Date.now();

        const res = apiPost(ENDPOINTS.PAYMENT_CREATE(orderId), {});
        const success = check(res, { 'Payment created': (r) => r.status === 200 });

        if (success) {
            try {
                const body = JSON.parse(res.body);
                paymentOrderId = body.data?.[0]?.paymentOrderId || body.data?.paymentOrderId;
            } catch (e) {}
        }

        paymentSuccessRate.add(success && paymentOrderId ? 1 : 0);
        paymentTime.add(Date.now() - start);
    });

    if (!paymentOrderId) {
        lifecycleSuccessRate.add(0);
        totalLifecycleTime.add(Date.now() - lifecycleStart);
        return;
    }

    sleep(randomSleep(100, 200));

    // ========================================
    // PHASE 6: VERIFY PAYMENT
    // ========================================
    group('Phase 6: Verify Payment', function () {
        const start = Date.now();

        const verifyPayload = generatePaymentVerifyDto();
        verifyPayload.razorpayOrderId = paymentOrderId;
        const res = apiPost(ENDPOINTS.PAYMENT_VERIFY(orderId), verifyPayload);

        const success = check(res, { 'Payment verified': (r) => r.status === 200 });
        paymentSuccessRate.add(success ? 1 : 0);
        paymentTime.add(Date.now() - start);
    });

    sleep(randomSleep(200, 400));

    // ========================================
    // PHASE 7: POS CALLBACK (ACCEPTED)
    // ========================================
    group('Phase 7: POS Accept', function () {
        const start = Date.now();

        const updatePayload = generateOrderStatusUpdate(menuSharingCode, orderId, ORDER_LIFECYCLE.ACCEPTED);
        const res = apiPost(ENDPOINTS.POS_ORDER_UPDATE, updatePayload);

        const success = check(res, { 'Order accepted': (r) => r.status === 200 });
        posSuccessRate.add(success ? 1 : 0);
        posTime.add(Date.now() - start);
    });

    sleep(randomSleep(200, 400));

    // ========================================
    // PHASE 8: POS CALLBACK (READY_FOR_DELIVERY)
    // ========================================
    group('Phase 8: Ready for Delivery', function () {
        const start = Date.now();

        const updatePayload = generateOrderStatusUpdate(menuSharingCode, orderId, ORDER_LIFECYCLE.READY_FOR_DELIVERY);
        const res = apiPost(ENDPOINTS.POS_ORDER_UPDATE, updatePayload);

        const success = check(res, { 'Order ready for delivery': (r) => r.status === 200 });
        posSuccessRate.add(success ? 1 : 0);
        posTime.add(Date.now() - start);
    });

    sleep(randomSleep(200, 400));

    // ========================================
    // PHASE 9: DELIVERY CALLBACKS
    // ========================================
    group('Phase 9: Delivery Callbacks', function () {
        const start = Date.now();

        // Generate consistent IDs for all callbacks
        const deliveryId = `${Date.now()}${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
        const channelOrderId = Math.floor(100000 + Math.random() * 900000);

        let logs = [];
        let allSuccess = true;
        const baseTime = new Date();

        // Minutes offset for each status (incremental timestamps)
        const statusTimeOffsets = {
            'CREATED': 1,
            'OUT_FOR_PICKUP': 3,
            'PICKED_UP': 12,
            'OUT_FOR_DELIVERY': 12,
            'DELIVERED': 22,
        };

        for (const status of DELIVERY_STATUS_SEQUENCE) {
            const minutesOffset = statusTimeOffsets[status] || 0;
            const { payload, logs: updatedLogs } = generateDeliveryCallback(
                orderId,
                deliveryId,
                channelOrderId,
                status,
                logs,
                baseTime,
                minutesOffset
            );

            const res = apiPost(ENDPOINTS.DELIVERY_CALLBACK, payload);
            const statusOk = check(res, { [`Delivery ${status}`]: (r) => r.status === 200 });

            if (statusOk) {
                logs = updatedLogs;
            } else {
                allSuccess = false;
            }
            sleep(randomSleep(50, 150));
        }

        deliverySuccessRate.add(allSuccess ? 1 : 0);
        deliveryTime.add(Date.now() - start);
    });

    sleep(randomSleep(200, 400));

    // ========================================
    // PHASE 10: USER TRACKING
    // ========================================
    group('Phase 10: User Tracking', function () {
        const start = Date.now();

        // User checks order status
        let res = apiGet(ENDPOINTS.ORDER_GET(orderId));
        const delivered = check(res, {
            'Order fetched': (r) => r.status === 200,
            'Status DELIVERED': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    const status = body.data?.[0]?.status || body.data?.status;
                    return status === 'DELIVERED';
                } catch (e) { return false; }
            },
        });

        // Track order
        res = apiGet(ENDPOINTS.ORDER_TRACK(orderId));
        check(res, { 'Track OK': (r) => r.status === 200 });

        trackingTime.add(Date.now() - start);

        if (delivered) {
            ordersDelivered.add(1);
            lifecycleSuccess = true;
        }
    });

    lifecycleSuccessRate.add(lifecycleSuccess ? 1 : 0);
    totalLifecycleTime.add(Date.now() - lifecycleStart);

    sleep(randomSleep(500, 1000));
}

export function setup() {
    console.log('='.repeat(70));
    console.log('ORDER LIFECYCLE TEST - Complete Backend Flow');
    console.log('='.repeat(70));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'NOT SET!'}`);
    console.log(`Mode: ${isMultiUserMode ? 'MULTI USER' : 'SINGLE USER'}`);
    if (isMultiUserMode) {
        console.log(`Users: ${userCount}, Orders: ${orderCount}`);
    }
    console.log('');
    console.log('Flow:');
    console.log('  1. Browse Menu → 2. Login → 3. Quote → 4. Create Order');
    console.log('  5. Create Payment → 6. Verify Payment');
    console.log('  7. POS ACCEPTED → 8. READY_FOR_DELIVERY');
    console.log('  9. Delivery Callbacks (CREATED → OUT_FOR_PICKUP → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED)');
    console.log('  10. User Tracking');
    console.log('='.repeat(70));

    if (!CONFIG.RESTAURANT_ID) {
        throw new Error('RESTAURANT_ID is required!');
    }

    // Fetch menu data
    console.log('\nFetching menu data...');
    const menuData = fetchMenuData(CONFIG.RESTAURANT_ID);

    if (menuData) {
        console.log(`Loaded ${menuData.items?.length || 0} items`);
    }

    return { startTime: Date.now(), menuData };
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000 / 60;
    console.log(`\nLifecycle test completed in ${duration.toFixed(1)} minutes`);
}

export function handleSummary(data) {
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
}
