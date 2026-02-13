/**
 * Single Order Test - Debug and Verification
 *
 * Executes a complete order lifecycle for a single order.
 *
 * Flow:
 * 1. Create Order
 * 2. Create Payment
 * 3. Verify Payment
 * 4. POS Callback (ACCEPTED)
 * 5. POS Callback (READY_FOR_DELIVERY)
 * 6. Delivery Callbacks: CREATED → OUT_FOR_PICKUP → REACHED_PICKUP → PICKED_UP → OUT_FOR_DELIVERY → REACHED_DELIVERY → DELIVERED
 * 7. Verify Order Delivered
 *
 * Usage:
 *   ./run-tests.sh single-order --restaurant 324672
 */

import { sleep, group, check } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { CONFIG, ENDPOINTS } from '../config.js';
import { apiGet, apiPost, extractId } from '../utils/helpers.js';
import {
    generatePaymentVerifyDto,
    generateOrderStatusUpdate,
    generateDeliveryCallback,
    ORDER_LIFECYCLE,
    DELIVERY_STATUS_SEQUENCE,
    fetchMenuData,
    fetchRestaurantLocation,
    generateDynamicOrderDto,
    generateOrderDto,
} from '../data/test-data.js';

// Custom metrics
const stepDuration = new Trend('step_duration');
const stepSuccess = new Rate('step_success_rate');

export const options = {
    scenarios: {
        single_order: {
            executor: 'shared-iterations',
            vus: 1,
            iterations: 1,
            maxDuration: '5m',
        },
    },
    thresholds: {
        'step_success_rate': ['rate>0.90'],
    },
};

export default function (data) {
    const restaurantId = CONFIG.RESTAURANT_ID;
    const customerId = CONFIG.CUSTOMER_ID;
    const menuData = data?.menuData;
    const menuSharingCode = data?.menuSharingCode;

    let orderId = null;
    let paymentOrderId = null;
    let deliveryId = null;

    console.log('\n' + '='.repeat(60));
    console.log('SINGLE ORDER TEST - Starting');
    console.log('='.repeat(60));
    console.log(`Restaurant: ${restaurantId}`);
    console.log(`Customer: ${customerId}`);
    console.log('');

    // ========================================
    // STEP 1: CREATE ORDER
    // ========================================
    group('Step 1: Create Order', function () {
        const start = Date.now();
        console.log('🛒 Step 1: Creating order...');

        let orderPayload;
        if (menuData && menuData.items && menuData.items.length > 0) {
            orderPayload = generateDynamicOrderDto(restaurantId, customerId, menuData, {
                paymentType: 'CREDIT',
                orderType: '1',
            });
            console.log(`   Using dynamic menu (${menuData.items.length} items available)`);
        } else {
            orderPayload = generateOrderDto(restaurantId, customerId, {
                paymentType: 'CREDIT',
                orderType: '1',
            });
            console.log('   Using static order data');
        }

        const res = apiPost(ENDPOINTS.ORDER_CREATE, orderPayload);

        const success = check(res, {
            'Order created': (r) => r.status === 200,
        });

        if (success) {
            try {
                const body = JSON.parse(res.body);
                orderId = body.data?.[0]?.id || body.data?.id;
            } catch (e) {
                orderId = extractId(res);
            }
            console.log(`   Order created, Order ID: ${orderId}`);
        } else {
            console.log(`   ❌ Order creation failed: ${res.status}`);
            try {
                console.log(`   Response: ${res.body.substring(0, 200)}`);
            } catch (e) {}
        }

        stepSuccess.add(success && orderId ? 1 : 0);
        stepDuration.add(Date.now() - start);
    });

    if (!orderId) {
        console.log('\n❌ TEST FAILED: Could not create order');
        return;
    }

    sleep(0.5);

    // ========================================
    // STEP 2: CREATE PAYMENT
    // ========================================
    group('Step 2: Create Payment', function () {
        const start = Date.now();
        console.log('💳 Step 2: Creating payment...');

        const res = apiPost(ENDPOINTS.PAYMENT_CREATE(orderId), {});
        const success = check(res, { 'Payment created': (r) => r.status === 200 });

        if (success) {
            try {
                const body = JSON.parse(res.body);
                paymentOrderId = body.data?.[0]?.paymentOrderId || body.data?.paymentOrderId;
                console.log(`   ✅ Payment order created: ${paymentOrderId}`);
            } catch (e) {
                console.log('   ⚠️ Could not extract payment order ID');
            }
        } else {
            console.log(`   ❌ Payment creation failed: ${res.status}`);
            try {
                console.log(`   Response: ${res.body.substring(0, 200)}`);
            } catch (e) {}
        }

        stepSuccess.add(success ? 1 : 0);
        stepDuration.add(Date.now() - start);
    });

    if (!paymentOrderId) {
        console.log('\n❌ TEST FAILED: Could not create payment');
        return;
    }

    sleep(0.3);

    // ========================================
    // STEP 3: VERIFY PAYMENT
    // ========================================
    group('Step 3: Verify Payment', function () {
        const start = Date.now();
        console.log('✓ Step 3: Verifying payment...');

        const verifyPayload = generatePaymentVerifyDto();
        verifyPayload.razorpayOrderId = paymentOrderId;
        const res = apiPost(ENDPOINTS.PAYMENT_VERIFY(orderId), verifyPayload);

        const success = check(res, { 'Payment verified': (r) => r.status === 200 });

        if (success) {
            console.log('   ✅ Payment verified');
        } else {
            console.log(`   ❌ Payment verification failed: ${res.status}`);
            try {
                console.log(`   Response: ${res.body.substring(0, 200)}`);
            } catch (e) {}
        }

        stepSuccess.add(success ? 1 : 0);
        stepDuration.add(Date.now() - start);
    });

    sleep(0.5);

    // ========================================
    // STEP 4: POS CALLBACK (ACCEPTED)
    // ========================================
    group('Step 4: POS Accept', function () {
        const start = Date.now();
        console.log('🏪 Step 4: POS accepting order...');

        const updatePayload = generateOrderStatusUpdate(menuSharingCode, orderId, ORDER_LIFECYCLE.ACCEPTED);
        const res = apiPost(ENDPOINTS.POS_ORDER_UPDATE, updatePayload);

        const success = check(res, { 'Order accepted': (r) => r.status === 200 });

        if (success) {
            console.log('   ✅ Order accepted by POS');
        } else {
            console.log(`   ❌ POS accept failed: ${res.status}`);
            try {
                console.log(`   Response: ${res.body.substring(0, 200)}`);
            } catch (e) {}
        }

        stepSuccess.add(success ? 1 : 0);
        stepDuration.add(Date.now() - start);
    });

    sleep(0.5);

    // ========================================
    // STEP 5: POS CALLBACK (READY_FOR_DELIVERY)
    // ========================================
    group('Step 5: Ready for Delivery', function () {
        const start = Date.now();
        console.log('📦 Step 5: POS marking ready for delivery...');

        const updatePayload = generateOrderStatusUpdate(menuSharingCode, orderId, ORDER_LIFECYCLE.READY_FOR_DELIVERY);
        const res = apiPost(ENDPOINTS.POS_ORDER_UPDATE, updatePayload);

        const success = check(res, { 'Order ready for delivery': (r) => r.status === 200 });

        if (success) {
            console.log('   ✅ Order ready for delivery');
        } else {
            console.log(`   ❌ Ready for delivery failed: ${res.status}`);
            try {
                console.log(`   Response: ${res.body.substring(0, 200)}`);
            } catch (e) {}
        }

        stepSuccess.add(success ? 1 : 0);
        stepDuration.add(Date.now() - start);
    });

    sleep(0.5);

    // ========================================
    // STEP 6: DELIVERY CALLBACKS
    // ========================================
    group('Step 6: Delivery Callbacks', function () {
        const start = Date.now();
        console.log('Step 6: Processing delivery callbacks...');

        // Fetch delivery record to get the real deliveryOrderId
        const deliveryRes = apiGet(ENDPOINTS.DELIVERY_STATUS(orderId));
        let channelOrderId = null;

        if (deliveryRes.status === 200) {
            try {
                const deliveryData = JSON.parse(deliveryRes.body);
                const delivery = deliveryData.data?.[0] || deliveryData.data;
                deliveryId = delivery?.deliveryOrderId || delivery?.deliveryOrderId;
                channelOrderId = delivery?.fulfillment?.channel?.order_id;
            } catch (e) {
                console.warn(`Failed to parse delivery record: ${e.message}`);
            }
        }

        if (!deliveryId) {
            console.warn(`No delivery record found for order ${orderId}, skipping delivery callbacks`);
            stepSuccess.add(0);
            stepDuration.add(Date.now() - start);
            return;
        }

        channelOrderId = channelOrderId || String(Math.floor(100000 + Math.random() * 900000));

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

        console.log('   Delivery status sequence:');
        console.log(`   Delivery Order ID: ${deliveryId}`);
        console.log(`   Channel Order ID: ${channelOrderId}`);

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
                console.log(`      ${status} OK (+${minutesOffset}min)`);
                logs = updatedLogs;
            } else {
                console.log(`      ${status} FAILED (${res.status})`);
                try {
                    console.log(`        Response: ${res.body.substring(0, 150)}`);
                } catch (e) {}
                allSuccess = false;
            }
            sleep(0.3);
        }

        stepSuccess.add(allSuccess ? 1 : 0);
        stepDuration.add(Date.now() - start);
    });

    sleep(0.5);

    // ========================================
    // STEP 7: VERIFY ORDER DELIVERED
    // ========================================
    group('Step 7: Verify Delivered', function () {
        const start = Date.now();
        console.log('✅ Step 7: Verifying order delivered...');

        const res = apiGet(ENDPOINTS.ORDER_GET(orderId));
        let orderStatus = 'UNKNOWN';

        try {
            const body = JSON.parse(res.body);
            orderStatus = body.data?.[0]?.status || body.data?.status || 'UNKNOWN';
        } catch (e) {}

        const delivered = orderStatus === 'DELIVERED';

        if (delivered) {
            console.log(`   ✅ Order status: ${orderStatus}`);
        } else {
            console.log(`   ⚠️ Order status: ${orderStatus} (expected DELIVERED)`);
        }

        stepSuccess.add(delivered ? 1 : 0);
        stepDuration.add(Date.now() - start);
    });

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(60));
    console.log('SINGLE ORDER TEST - Complete');
    console.log('='.repeat(60));
    console.log(`Order ID: ${orderId}`);
    console.log(`Menu Sharing Code: ${menuSharingCode}`);
    console.log(`Payment Order ID: ${paymentOrderId}`);
    console.log(`Delivery Order ID: ${deliveryId}`);
    console.log('='.repeat(60) + '\n');
}

export function setup() {
    console.log('='.repeat(60));
    console.log('SINGLE ORDER TEST - Setup');
    console.log('='.repeat(60));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'NOT SET!'}`);
    console.log(`Customer: ${CONFIG.CUSTOMER_ID || 'NOT SET!'}`);
    console.log('');

    if (!CONFIG.RESTAURANT_ID) {
        throw new Error('RESTAURANT_ID is required! Use --restaurant flag');
    }

    if (!CONFIG.CUSTOMER_ID) {
        throw new Error('CUSTOMER_ID is required! Set in configs/.env');
    }

    // Fetch restaurant data (menuSharingCode)
    console.log('Fetching restaurant data...');
    const restaurantData = fetchRestaurantLocation(CONFIG.RESTAURANT_ID);
    const menuSharingCode = restaurantData?.menuSharingCode || null;

    if (menuSharingCode) {
        console.log(`Menu sharing code: ${menuSharingCode}`);
    } else {
        console.warn('Could not fetch menuSharingCode from restaurant API');
    }

    // Fetch menu data
    console.log('Fetching menu data...');
    const menuData = fetchMenuData(CONFIG.RESTAURANT_ID);

    if (menuData) {
        console.log(`Loaded ${menuData.items?.length || 0} menu items`);
    } else {
        console.log('Using static order data');
    }

    console.log('');
    console.log('Flow: CREATE ORDER → CREATE PAYMENT → VERIFY PAYMENT');
    console.log('      → POS ACCEPTED → DELIVERY CALLBACKS → DELIVERED');
    console.log('='.repeat(60) + '\n');

    return { startTime: Date.now(), menuData, menuSharingCode };
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000;
    console.log(`\nTest completed in ${duration.toFixed(1)} seconds`);
}

export function handleSummary(data) {
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
}
