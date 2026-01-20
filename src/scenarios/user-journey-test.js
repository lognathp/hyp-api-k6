/**
 * User Journey Test - Complete User Flow (Frontend Perspective)
 *
 * Simulates complete user journey:
 * 1. Browse Menu (fetch categories, items, addons)
 * 2. View items / Add to cart
 * 3. Login (OTP flow)
 * 4. Add/Select address
 * 5. Get delivery quote
 * 6. Place order
 * 7. Create payment
 * 8. Verify payment
 *
 * Modes:
 * - sanity: Single user, quick validation (~2 min)
 * - load:   Multiple users, full load test (~10 min)
 *
 * Usage:
 *   ./run-tests.sh user-journey --restaurant 324672 --mode sanity  # Quick validation
 *   ./run-tests.sh user-journey --restaurant 324672                # Full load test
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
    fetchRestaurantLocation,
    generateDynamicOrderDto,
    generateOrderDto,
    generateAddressDto,
} from '../data/test-data.js';

// Custom metrics
const journeySuccessRate = new Rate('journey_success_rate');
const menuBrowseTime = new Trend('menu_browse_duration');
const loginTime = new Trend('login_duration');
const quoteTime = new Trend('quote_duration');
const orderTime = new Trend('order_duration');
const paymentTime = new Trend('payment_duration');
const totalJourneyTime = new Trend('total_journey_duration');
const journeysCompleted = new Counter('journeys_completed');
const journeysFailed = new Counter('journeys_failed');

// Check if sanity mode (single user validation)
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

const loadScenario = {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
        { duration: '1m', target: 15 },    // Ramp up
        { duration: '2m', target: 30 },    // Increase
        { duration: '3m', target: 50 },    // Peak load
        { duration: '2m', target: 30 },    // Scale down
        { duration: '2m', target: 15 },    // Further down
        { duration: '1m', target: 0 },     // Ramp down
    ],
};

export const options = {
    scenarios: {
        user_journey: isSanityMode ? sanityScenario : loadScenario,
    },
    thresholds: {
        ...THRESHOLDS,
        'journey_success_rate': ['rate>0.85'],
        'menu_browse_duration': ['p(95)<3000'],
        'login_duration': ['p(95)<3000'],
        'order_duration': ['p(95)<4000'],
        'payment_duration': ['p(95)<3000'],
        'total_journey_duration': ['p(95)<20000'],
    },
};

export default function (data) {
    const restaurantId = CONFIG.RESTAURANT_ID;
    const menuData = data?.menuData;
    const restaurantLocation = data?.restaurantLocation;
    const user = getUserFromPool(userPool, __VU);

    const journeyStart = Date.now();
    let journeySuccess = false;
    let customerId = null;
    let orderId = null;

    // ========================================
    // STEP 1: Browse Menu
    // ========================================
    group('1. Browse Menu', function () {
        const start = Date.now();

        // Fetch menu categories with items
        let res = apiGet(ENDPOINTS.MENU_CATEGORY(restaurantId));
        check(res, { 'Menu loaded': (r) => r.status === 200 });

        sleep(randomSleep(500, 1000)); // User reading menu

        // Fetch addons
        res = apiGet(ENDPOINTS.ADDON_GROUP_LIST);
        check(res, { 'Addons loaded': (r) => r.status === 200 });

        sleep(randomSleep(300, 600)); // User browsing

        // Fetch variations
        res = apiGet(ENDPOINTS.VARIATION_LIST);

        menuBrowseTime.add(Date.now() - start);
    });

    sleep(randomSleep(1000, 2000)); // User selecting items

    // ========================================
    // STEP 2: Login
    // ========================================
    group('2. Login', function () {
        const start = Date.now();

        // Request OTP
        const loginDto = generateLoginDto(user.name, user.mobile);
        let res = apiPost(ENDPOINTS.LOGIN_OTP, loginDto);

        if (res.status !== 200) {
            console.warn(`OTP request failed for ${user.mobile}`);
            journeysFailed.add(1);
            return;
        }

        sleep(randomSleep(500, 1000)); // User entering OTP

        // Verify OTP
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

        loginTime.add(Date.now() - start);
    });

    if (!customerId) {
        journeysFailed.add(1);
        journeySuccessRate.add(0);
        totalJourneyTime.add(Date.now() - journeyStart);
        return;
    }

    sleep(randomSleep(500, 1000));

    // ========================================
    // STEP 3: Address & Delivery Quote
    // ========================================
    let addressId = null;
    group('3. Address & Quote', function () {
        const start = Date.now();

        // Fetch customer addresses (200 = has addresses, 404 = no addresses - both are valid)
        let res = apiGet(`${ENDPOINTS.ADDRESS_LIST}?customerId=${customerId}`);
        check(res, { 'Address API responded': (r) => r.status === 200 || r.status === 404 });

        // Parse addresses and get first available address (if any exist)
        if (res.status === 200) {
            try {
                const body = JSON.parse(res.body);
                const addresses = body.data || [];
                if (addresses.length > 0) {
                    // Use the first address (or default if available)
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
                    addressId = body.data?.id || body.data?._id || body.data?.[0]?.id;
                    check(res, { 'Address created': () => !!addressId });
                } catch (e) {
                    console.warn(`Failed to parse created address: ${e.message}`);
                }
            }
        }

        if (!addressId) {
            console.warn('No address available, using fallback');
            addressId = '106335'; // Fallback to default
        }

        sleep(randomSleep(300, 500));

        // Get delivery quote with customer's actual address
        res = apiGet(`${ENDPOINTS.DELIVERY_QUOTE(restaurantId)}?addressId=${addressId}`);
        check(res, { 'Quote received': (r) => r.status === 200 || r.status === 404 });

        quoteTime.add(Date.now() - start);
    });

    sleep(randomSleep(500, 1000)); // User reviewing quote

    // ========================================
    // STEP 4: Place Order
    // ========================================
    group('4. Place Order', function () {
        const start = Date.now();

        // Generate order with online payment and customer's address
        let orderPayload;
        const orderOptions = {
            paymentType: 'CREDIT',
            orderType: '1',
            addressId: addressId, // Use customer's actual address
        };

        if (menuData && menuData.items && menuData.items.length > 0) {
            orderPayload = generateDynamicOrderDto(restaurantId, customerId, menuData, orderOptions);
        } else {
            orderPayload = generateOrderDto(restaurantId, customerId, orderOptions);
        }

        const res = apiPost(ENDPOINTS.ORDER_CREATE, orderPayload);

        const success = check(res, {
            'Order created': (r) => r.status === 200,
            'Order ID received': (r) => {
                orderId = extractId(r);
                return !!orderId;
            },
        });

        orderTime.add(Date.now() - start);

        if (!success) {
            console.warn(`Order failed for ${user.mobile}: ${res.status}`);
        }
    });

    if (!orderId) {
        journeysFailed.add(1);
        journeySuccessRate.add(0);
        totalJourneyTime.add(Date.now() - journeyStart);
        return;
    }

    sleep(randomSleep(300, 600));

    // ========================================
    // STEP 5: Payment
    // ========================================
    group('5. Payment', function () {
        const start = Date.now();
        let paymentOrderId = null;

        // Create payment order
        let res = apiPost(ENDPOINTS.PAYMENT_CREATE(orderId), {});

        if (res.status === 200) {
            try {
                const body = JSON.parse(res.body);
                paymentOrderId = body.data?.[0]?.paymentOrderId;
            } catch (e) {}
        }

        if (!paymentOrderId) {
            console.warn(`Payment create failed for order ${orderId}`);
            paymentTime.add(Date.now() - start);
            return;
        }

        sleep(randomSleep(500, 1000)); // User completing payment

        // Verify payment
        const verifyPayload = generatePaymentVerifyDto();
        verifyPayload.razorpayOrderId = paymentOrderId;
        res = apiPost(ENDPOINTS.PAYMENT_VERIFY(orderId), verifyPayload);

        const success = check(res, {
            'Payment verified': (r) => r.status === 200,
        });

        paymentTime.add(Date.now() - start);

        if (success) {
            journeySuccess = true;
            journeysCompleted.add(1);
            console.log(`Journey complete: Order ${orderId} for ${user.mobile}`);
        }
    });

    totalJourneyTime.add(Date.now() - journeyStart);
    journeySuccessRate.add(journeySuccess ? 1 : 0);

    if (!journeySuccess) {
        journeysFailed.add(1);
    }

    sleep(randomSleep(1000, 2000));
}

export function setup() {
    console.log('='.repeat(60));
    console.log(`USER JOURNEY TEST - ${isSanityMode ? 'SANITY MODE' : 'LOAD TEST'}`);
    console.log('='.repeat(60));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'NOT SET!'}`);
    console.log(`Mode: ${isSanityMode ? 'sanity (single user validation)' : 'load (multi-user)'}`);
    console.log(`User Pool: ${userPool.length} users`);
    console.log('');
    console.log('Flow: Menu → Login → Address → Quote → Order → Payment');
    if (isSanityMode) {
        console.log('VUs: 1 (single iteration)');
        console.log('Duration: ~2 minutes');
    } else {
        console.log('Load Pattern: 0 → 15 → 30 → 50 → 30 → 15 → 0 VUs');
        console.log('Duration: ~10 minutes');
    }
    console.log('='.repeat(60));

    if (!CONFIG.RESTAURANT_ID) {
        throw new Error('RESTAURANT_ID is required! Use --env RESTAURANT_ID=xxx');
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
    } else {
        console.warn('Using static menu data');
    }

    return { startTime: Date.now(), menuData, restaurantLocation };
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000 / 60;
    console.log(`\nUser journey test completed in ${duration.toFixed(1)} minutes`);
}

export function handleSummary(data) {
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
}
