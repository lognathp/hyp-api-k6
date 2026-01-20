/**
 * Order Lifecycle Test - Complete Backend Flow
 *
 * Full order lifecycle including all backend operations:
 *
 * Flow:
 * 1. Browse Menu → View Items & Addons
 * 2. Login (OTP Request → Verify)
 * 3. Address & Delivery Quote (fetch/create customer address)
 * 4. Create Order
 * 5. Create Payment
 * 6. Verify Payment
 * 7. POS Callback (ACCEPTED)
 * 8. POS Callback (READY_FOR_DELIVERY)
 * 9. Delivery Callbacks: CREATED → OUT_FOR_PICKUP → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
 * 10. User Tracking (verify delivered)
 *
 * Modes:
 * - sanity: Single user, single order (~5 min) - for script validation
 * - single: Ramping VUs load test (~15 min)
 * - multi:  Shared iterations, configurable orders
 *
 * Usage:
 *   ./run-tests.sh lifecycle --restaurant 324672 --mode sanity   # Quick validation
 *   ./run-tests.sh lifecycle --restaurant 324672                 # Load test
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
    fetchRestaurantLocation,
    generateDynamicOrderDto,
    generateOrderDto,
    generateAddressDto,
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
const isSanityMode = CONFIG.USER_MODE === 'sanity';
const isMultiUserMode = CONFIG.USER_MODE === 'multi';
const userCount = isSanityMode ? 1 : CONFIG.USER_COUNT;
const orderCount = isSanityMode ? 1 : CONFIG.ORDER_COUNT;

// Generate user pool
const userPool = generateUserPool(userCount);

// Scenario configurations
const sanityScenario = {
    executor: 'per-vu-iterations',
    vus: 1,
    iterations: 1,
    maxDuration: '10m',
};

const multiScenario = {
    executor: 'shared-iterations',
    vus: Math.min(50, orderCount),
    iterations: orderCount,
    maxDuration: '60m',
};

const loadScenario = {
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
};

// Select scenario based on mode
function getScenario() {
    if (isSanityMode) return sanityScenario;
    if (isMultiUserMode) return multiScenario;
    return loadScenario;
}

export const options = {
    scenarios: {
        order_lifecycle: getScenario(),
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
    const restaurantLocation = data?.restaurantLocation;
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
    // PHASE 3: ADDRESS & DELIVERY QUOTE
    // ========================================
    let addressId = null;
    group('Phase 3: Address & Delivery Quote', function () {
        // Fetch customer addresses (200 = has addresses, 404 = no addresses - both are valid)
        let res = apiGet(`${ENDPOINTS.ADDRESS_LIST}?customerId=${customerId}`);
        check(res, { 'Address API responded': (r) => r.status === 200 || r.status === 404 });

        // Parse addresses and get first available address (if any exist)
        if (res.status === 200) {
            try {
                const body = JSON.parse(res.body);
                const addresses = body.data || [];
                if (addresses.length > 0) {
                    const defaultAddr = addresses.find(a => a.isDefault);
                    addressId = defaultAddr?.id || addresses[0]?.id || addresses[0]?._id;
                }
            } catch (e) {
                console.warn(`Failed to parse addresses: ${e.message}`);
            }
        }

        // If no address exists, create one for this customer
        if (!addressId) {
            console.log(`No address found for customer ${customerId}, creating one...`);
            const addressPayload = generateAddressDto(customerId, restaurantLocation);
            res = apiPost(ENDPOINTS.ADDRESS_CREATE, addressPayload);

            if (res.status === 200) {
                try {
                    const body = JSON.parse(res.body);
                    console.log(`Created address: ${body.data}`);
                    addressId = body.data?.id || body.data?._id || body.data?.[0]?.id;
                } catch (e) {
                    console.warn(`Failed to parse created address: ${e.message}`);
                }
            }
        }

        if (!addressId) {
            console.warn('No address available, using fallback');
            addressId = '106335'; // Fallback to default
        }

        // Get delivery quote with customer's actual address
        res = apiGet(`${ENDPOINTS.DELIVERY_QUOTE(restaurantId)}?addressId=${addressId}`);
        check(res, { 'Quote received': (r) => r.status === 200 || r.status === 404 });
    });

    sleep(randomSleep(200, 400));

    // ========================================
    // PHASE 4: CREATE ORDER
    // ========================================
    group('Phase 4: Create Order', function () {
        const start = Date.now();

        const orderOptions = {
            paymentType: 'CREDIT',
            orderType: '1',
            addressId: addressId, // Use customer's actual address
        };

        let orderPayload;
        if (menuData && menuData.items && menuData.items.length > 0) {
            orderPayload = generateDynamicOrderDto(restaurantId, customerId, menuData, orderOptions);
        } else {
            orderPayload = generateOrderDto(restaurantId, customerId, orderOptions);
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
    const modeLabel = isSanityMode ? 'SANITY MODE' : (isMultiUserMode ? 'MULTI USER' : 'LOAD TEST');

    console.log('='.repeat(70));
    console.log(`ORDER LIFECYCLE TEST - ${modeLabel}`);
    console.log('='.repeat(70));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'NOT SET!'}`);
    console.log(`Mode: ${modeLabel}`);
    if (isSanityMode) {
        console.log('VUs: 1 (single iteration for validation)');
    } else if (isMultiUserMode) {
        console.log(`Users: ${userCount}, Orders: ${orderCount}`);
    } else {
        console.log('Load Pattern: 0 → 10 → 20 → 30 → 20 → 10 → 0 VUs');
    }
    console.log('');
    console.log('Flow:');
    console.log('  1. Browse Menu → 2. Login → 3. Address & Quote → 4. Create Order');
    console.log('  5. Create Payment → 6. Verify Payment');
    console.log('  7. POS ACCEPTED → 8. READY_FOR_DELIVERY');
    console.log('  9. Delivery Callbacks (CREATED → OUT_FOR_PICKUP → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED)');
    console.log('  10. User Tracking');
    console.log('='.repeat(70));

    if (!CONFIG.RESTAURANT_ID) {
        throw new Error('RESTAURANT_ID is required!');
    }

    // Fetch restaurant location for address creation
    console.log('\nFetching restaurant location...');
    const restaurantData = fetchRestaurantLocation(CONFIG.RESTAURANT_ID);
    const restaurantLocation = restaurantData?.location || null;

    if (restaurantLocation) {
        console.log(`Restaurant location: lat=${restaurantLocation.latitude}, lng=${restaurantLocation.longitude}`);
    } else {
        console.warn('Could not fetch restaurant location, will use fallback');
    }

    // Fetch menu data
    console.log('\nFetching menu data...');
    const menuData = fetchMenuData(CONFIG.RESTAURANT_ID);

    if (menuData) {
        console.log(`Loaded ${menuData.items?.length || 0} items`);
    }

    return { startTime: Date.now(), menuData, restaurantLocation };
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
