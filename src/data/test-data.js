/**
 * Test Data for Load Testing
 * HYP Backend API - v2 (Main Branch)
 *
 * Matches actual DTO structures from the API
 *
 * Supports two modes:
 * - Single user mode: Use one customer for all orders
 * - Multi user mode: Generate pool of users (1000+)
 *
 * Also supports:
 * - Static data: Hardcoded sample items/taxes (fast, no API calls)
 * - Dynamic data: Fetched from API based on restaurant ID (see dynamic-data.js)
 */

import { SharedArray } from 'k6/data';

// Re-export dynamic data functions for convenience
export {
    fetchMenuData,
    fetchCustomerAddresses,
    fetchRestaurantLocation,
    generateDynamicOrderDto,
    getRandomItems,
    validateMenuData,
    printMenuSummary,
} from './dynamic-data.js';

// ============================================
// USER POOL CONFIGURATION
// ============================================

// Base mobile number prefix for generated users
const MOBILE_PREFIX = '9800000';

// Generate user pool (shared across VUs for efficiency)
export function generateUserPool(count = 1000) {
    const users = [];
    for (let i = 0; i < count; i++) {
        const suffix = String(i).padStart(3, '0');
        users.push({
            index: i,
            name: `LoadTest User ${i}`,
            mobile: `${MOBILE_PREFIX}${suffix}`,
        });
    }
    return users;
}

// Get a user from pool by VU id (round-robin)
export function getUserFromPool(users, vuId) {
    return users[vuId % users.length];
}

// Get random user from pool
export function getRandomUser(users) {
    return users[Math.floor(Math.random() * users.length)];
}

// ============================================
// LOGIN DATA GENERATORS
// ============================================

/**
 * Generate LoginDto for /login/otp
 */
export function generateLoginDto(name, mobile) {
    return {
        name: name || `LoadTest User ${Date.now()}`,
        mobile: mobile || `98${Date.now().toString().slice(-8)}`,
    };
}

/**
 * Generate VerificationRequestDto for /login/verify-otp
 */
export function generateVerifyOtpDto(mobile, restaurantId, otp = 123456) {
    return {
        mobile: mobile,
        restaurantId: restaurantId,
        otp: otp,
    };
}

// ============================================
// ORDER STATUS AND TYPES
// ============================================

// Order status types
export const ORDER_STATUS = [
    'PENDING', 'ACCEPTED', 'READY_FOR_DELIVERY',
    'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'
];

// Order types (API uses string numbers)
export const ORDER_TYPES = ['1', '2', '3']; // 1=DELIVERY, 2=PICKUP, 3=DINE_IN

// Payment types
export const PAYMENT_TYPES = ['CREDIT', 'COD', 'CARD', 'UPI'];

// Tax IDs (from your system)
export const TAX_IDS = {
    CGST: '271757',
    SGST: '271758',
};

// Sample menu items (from your database)
export const SAMPLE_ITEMS = [
    {
        id: '10523187',
        name: 'Double Chicken Burger Combo',
        description: 'Chicken fillet in a bun with coleslaw, lettuce, pickles and our spicy cocktail sauce.',
        price: 569.50,
        cgstRate: 2.5,
        sgstRate: 2.5,
    },
    {
        id: '10523188',
        name: 'Vanilla Icecream',
        description: 'Vanilla Icecream',
        price: 19.0,
        cgstRate: 2.5,
        sgstRate: 2.5,
    },
    {
        id: '1269809087',
        name: 'Vegetable Green Thai Curry With Jasmine Rice',
        description: 'Thai curry with jasmine rice',
        price: 250.0,
        cgstRate: 2.5,
        sgstRate: 2.5,
    },
    {
        id: '1269869732',
        name: 'Paneer Inferno',
        description: 'Spicy paneer dish',
        price: 180.0,
        cgstRate: 2.5,
        sgstRate: 2.5,
    },
];

// Sample address IDs (from your database)
// Use valid address IDs that exist for your test customer
export const SAMPLE_ADDRESS_IDS = ['106335'];

// Sample addresses for creating new addresses
// Location will be set dynamically based on restaurant location
export const SAMPLE_ADDRESSES = [
    {
        addressOne: '123 Test Street',
        addressTwo: 'Sector 15',
        city: 'Gurugram',
        state: 'Haryana',
        country: 'India',
        pincode: '122001',
        landmark: 'Near Test Mall',
    },
    {
        addressOne: '456 Load Test Avenue',
        addressTwo: 'DLF Phase 2',
        city: 'Gurugram',
        state: 'Haryana',
        country: 'India',
        pincode: '122002',
        landmark: 'Opposite Test Tower',
    },
    {
        addressOne: '789 Performance Road',
        addressTwo: 'Cyber City',
        city: 'Gurugram',
        state: 'Haryana',
        country: 'India',
        pincode: '122018',
        landmark: 'Near Cyber Hub',
    },
];

/**
 * Generate OrderDto matching the actual API structure
 */
export function generateOrderDto(restaurantId, customerId, options = {}) {
    const itemCount = options.itemCount || Math.floor(Math.random() * 2) + 1;
    const orderItems = [];
    let subtotal = 0;
    let totalCgst = 0;
    let totalSgst = 0;

    // Generate order items
    for (let i = 0; i < itemCount; i++) {
        const item = SAMPLE_ITEMS[Math.floor(Math.random() * SAMPLE_ITEMS.length)];
        const quantity = Math.floor(Math.random() * 2) + 1;
        const finalPrice = item.price * quantity;
        const cgstAmount = (finalPrice * item.cgstRate) / 100;
        const sgstAmount = (finalPrice * item.sgstRate) / 100;

        subtotal += finalPrice;
        totalCgst += cgstAmount;
        totalSgst += sgstAmount;

        orderItems.push({
            id: item.id,
            name: item.name,
            description: item.description,
            itemDiscount: 0,
            finalPrice: finalPrice,
            quantity: quantity,
            price: item.price,
            orderItemTax: [
                {
                    id: TAX_IDS.CGST,
                    name: 'CGST',
                    amount: parseFloat(cgstAmount.toFixed(2)),
                },
                {
                    id: TAX_IDS.SGST,
                    name: 'SGST',
                    amount: parseFloat(sgstAmount.toFixed(2)),
                },
            ],
        });
    }

    const taxAmount = totalCgst + totalSgst;
    const deliveryCharge = options.orderType === '2' ? 0 : 53.1; // No delivery for pickup
    const packagingCharge = 20;
    const grandTotal = subtotal + taxAmount + deliveryCharge + packagingCharge;

    const now = new Date();
    const deliveryTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

    return {
        restaurantId: restaurantId,
        customerId: customerId,
        orderType: options.orderType || ORDER_TYPES[0], // Default: DELIVERY
        paymentType: options.paymentType || 'CREDIT',
        description: 'Order + Tax',
        orderItems: orderItems,
        orderTax: [
            {
                id: TAX_IDS.CGST,
                title: 'CGST',
                type: '1',
                price: 2.5,
                tax: parseFloat(totalCgst.toFixed(2)),
                restaurantLiableAmt: parseFloat(totalCgst.toFixed(2)),
            },
            {
                id: TAX_IDS.SGST,
                title: 'SGST',
                type: '1',
                price: 2.5,
                tax: parseFloat(totalSgst.toFixed(2)),
                restaurantLiableAmt: parseFloat(totalSgst.toFixed(2)),
            },
        ],
        deliveryDetails: {
            addressId: options.addressId || SAMPLE_ADDRESS_IDS[0],
            service: 'wefast',
            pickupNow: true,
            networkId: 18,
        },
        specialInstructions: options.specialInstructions || 'Load test order',
        orderTime: now.toISOString(),
        expectedDeliveryTime: deliveryTime.toISOString(),
        totalAmount: parseFloat(grandTotal.toFixed(2)),
        discountAmount: 0.0,
        taxAmount: parseFloat(taxAmount.toFixed(2)),
        deliveryCharge: deliveryCharge,
        dcTaxAmount: 0,
        packagingCharge: packagingCharge,
        pcTaxAmount: 0.0,
        serviceCharge: 0.0,
        scTaxAmount: 0.0,
        grandTotalAmount: parseFloat(grandTotal.toFixed(2)),
    };
}

/**
 * Generate CustomerDto matching the actual API structure
 */
export function generateCustomerDto(restaurantId) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    return {
        name: `Load Test User ${id}`,
        mobile: `98${id.toString().slice(-8).padStart(8, '0')}`,
        email: `loadtest${id}@test.com`,
        restaurants: restaurantId ? [restaurantId] : [],
    };
}

/**
 * Generate AddressDto matching the actual API structure
 * @param {string} customerId - Customer ID
 * @param {object} location - Restaurant location { latitude, longitude }
 */
export function generateAddressDto(customerId, location = null) {
    const address = SAMPLE_ADDRESSES[Math.floor(Math.random() * SAMPLE_ADDRESSES.length)];

    // Use provided location (restaurant's location) or fallback
    const addressLocation = location || {
        latitude: 28.4595,
        longitude: 77.0266,
    };

    return {
        customerId: customerId,
        ...address,
        location: addressLocation,
        addressType: 'HOME',
        isDefault: true,
    };
}

/**
 * Generate PaymentDto for payment creation
 */
export function generatePaymentDto(orderId, amount) {
    return {
        orderId: orderId,
        amount: amount * 100, // Convert to paise
        currency: 'INR',
        receipt: `rcpt_${Date.now()}`,
    };
}

/**
 * Generate RazorpayVerifyDto for payment verification
 */
export function generatePaymentVerifyDto() {
    return {
        razorpay_payment_id: `pay_${Date.now()}`,
        razorpay_signature: 'mock_signature_for_load_test',
    };
}

/**
 * Get random address from samples
 */
export function getRandomAddress() {
    return SAMPLE_ADDRESSES[Math.floor(Math.random() * SAMPLE_ADDRESSES.length)];
}

/**
 * Get random order type
 */
export function getRandomOrderType() {
    return ORDER_TYPES[Math.floor(Math.random() * ORDER_TYPES.length)];
}

/**
 * Get random payment type
 */
export function getRandomPaymentType() {
    return PAYMENT_TYPES[Math.floor(Math.random() * PAYMENT_TYPES.length)];
}

// ============================================
// ORDER LIFECYCLE - Status Constants
// ============================================

// Order status lifecycle for delivery orders
export const ORDER_LIFECYCLE = {
    CREATED: 'CREATED',
    PAYMENT_PENDING: 'PAYMENT_PENDING',
    PAID: 'PAID',
    ACCEPTED: 'ACCEPTED',
    READY_FOR_DELIVERY: 'READY_FOR_DELIVERY',
    SEARCHING_RIDER: 'SEARCHING_RIDER',
    RIDER_ASSIGNED: 'RIDER_ASSIGNED',
    OUT_FOR_PICKUP: 'OUT_FOR_PICKUP',
    PICKED_UP: 'PICKED_UP',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
};

// Delivery fulfillment status types
export const DELIVERY_FULFILL_STATUS = {
    CREATED: 'CREATED',
    OUT_FOR_PICKUP: 'OUT_FOR_PICKUP',
    REACHED_PICKUP: 'REACHED_PICKUP',
    PICKED_UP: 'PICKED_UP',
    IN_TRANSIT: 'IN_TRANSIT',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    REACHED_DELIVERY: 'REACHED_DELIVERY',
    DELIVERED: 'DELIVERED',
};

// ============================================
// ORDER STATUS UPDATE GENERATORS
// ============================================

/**
 * Generate POS order status update payload
 * Status codes: 3 = ACCEPTED, 5 = READY_FOR_DELIVERY
 */
export function generateOrderStatusUpdate(menuSharingCode, orderId, status) {
    // Map status names to POS status codes
    const statusMap = {
        'ACCEPTED': '3',
        'READY_FOR_DELIVERY': '5',
    };

    const statusCode = statusMap[status] || status;

    return {
        restID: menuSharingCode,
        orderID: String(orderId),
        status: statusCode,
        minimum_prep_time: 15,
        minimum_delivery_time: "",
    };
}

// ============================================
// DELIVERY CALLBACK GENERATORS
// ============================================

/**
 * Delivery status sequence for complete order flow
 * CREATED → OUT_FOR_PICKUP → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
 */
export const DELIVERY_STATUS_SEQUENCE = [
    'CREATED',
    'OUT_FOR_PICKUP',
    'PICKED_UP',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
];

/**
 * Status remarks mapping
 */
const STATUS_REMARKS = {
    'CREATED': null,
    'OUT_FOR_PICKUP': 'Start for Pickup',
    'PICKED_UP': 'admin quick scan',
    'OUT_FOR_DELIVERY': 'Start for Delivery',
    'DELIVERED': null,
};

/**
 * Generate DeliveryOrderData for delivery callback
 * Matches the exact Pidge captive delivery callback payload structure
 *
 * @param {string} orderId - The order ID (reference_id in payload)
 * @param {string} deliveryOrderId - The delivery order ID created by backend (id in payload)
 * @param {string} channelOrderId - The channel's order ID (fulfillment.channel.order_id)
 * @param {string} fulfillmentStatus - Current delivery status
 * @param {Array} previousLogs - Accumulated logs from previous callbacks
 * @param {Date} baseTime - Base timestamp for the order
 * @param {number} minutesOffset - Minutes offset from base time for this status
 */
export function generateDeliveryCallback(orderId, deliveryOrderId, channelOrderId, fulfillmentStatus, previousLogs = [], baseTime = null, minutesOffset = 0) {
    const base = baseTime || new Date();
    const currentTime = new Date(base.getTime() + minutesOffset * 60 * 1000);
    const timestamp = currentTime.toISOString();

    // Determine overall status based on fulfillment status
    const status = fulfillmentStatus === 'DELIVERED' ? 'completed' : 'fulfilled';

    // Location coordinates
    const location = {
        latitude: 28.442554,
        longitude: 77.08023,
    };

    // Rider info
    const rider = {
        id: '306',
        name: 'Rider name',
        mobile: '8887772221',
    };

    // Channel info
    const channel = {
        name: 'captive',
        id: '-2',
        order_id: String(channelOrderId),
    };

    // Build current log entry
    const currentLog = {
        timestamp: timestamp,
        status: fulfillmentStatus,
        channel: channel,
        attemptType: 'FORWARD',
    };

    // Add location and rider for non-CREATED statuses
    if (fulfillmentStatus !== 'CREATED') {
        currentLog.location = location;
        currentLog.rider = rider;
        currentLog.remark = STATUS_REMARKS[fulfillmentStatus];
    }

    // Accumulate logs
    const logs = [...previousLogs, currentLog];

    // Build pickup info
    const pickup = {
        eta: new Date(base.getTime() + 12 * 60 * 1000).toISOString(),
        proof: [],
    };

    // Add pickup location/timestamp after PICKED_UP
    if (['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(fulfillmentStatus)) {
        pickup.location = location;
        pickup.timestamp = timestamp;
    }

    // Build drop info
    const drop = {
        eta: new Date(base.getTime() + 22 * 60 * 1000).toISOString(),
        proof: [],
    };

    // Add drop location/timestamp for DELIVERED
    if (fulfillmentStatus === 'DELIVERED') {
        drop.location = location;
        drop.timestamp = timestamp;
    }

    const payload = {
        id: String(deliveryOrderId),
        dd_channel: {
            name: 'Hyperapps Testing',
            order_id: String(orderId),
            user: { id: 853, type: 4 },
            source: { id: 1 },
        },
        reference_id: String(orderId),
        bill_amount: 637.9,
        cod_amount: 0,
        created_at: new Date(base.getTime() + 1 * 60 * 1000).toISOString(),
        customer_detail: {
            name: 'John Doe',
            mobile: '1234567890',
        },
        sender_detail: {
            name: 'Hyperapps Demo',
            mobile: '1234567890',
        },
        poc_detail: {
            name: 'Hyperapps',
            mobile: '8754556606',
        },
        status: status,
        updated_at: timestamp,
        notes: [],
        pickup_drop_distance: 0,
        fulfillment: {
            channel: channel,
            logs: logs,
            status: fulfillmentStatus,
            pickup: pickup,
            rider: fulfillmentStatus !== 'CREATED' ? rider : undefined,
            drop: drop,
            mtg: {
                trip_id: 529719,
                group_id: 204359,
                rider_id: 306,
                bundle_id: 142707,
                sequence_number: 1,
            },
            track_code: 'rk3vx7',
            delivery_charge: 189,
        },
        owner: {
            id: 815,
            type: 4,
            name: 'Test Pidge R',
        },
        parent_id: null,
    };

    // Remove undefined rider for CREATED status
    if (fulfillmentStatus === 'CREATED') {
        delete payload.fulfillment.rider;
    }

    return { payload, logs };
}

/**
 * Generate Razorpay payment callback event
 */
export function generatePaymentCallback(paymentOrderId, orderId, eventType = 'order.paid') {
    const paymentId = `pay_${Date.now()}`;

    return {
        event: eventType,
        payload: {
            payment: {
                entity: {
                    id: paymentId,
                    order_id: paymentOrderId,
                    status: eventType === 'order.paid' ? 'captured' : 'failed',
                    amount: 50000,
                    currency: 'INR',
                },
            },
        },
    };
}

/**
 * Get delivery status sequence for simulating order lifecycle
 */
export function getDeliveryStatusSequence() {
    return [
        DELIVERY_FULFILL_STATUS.OUT_FOR_PICKUP,
        DELIVERY_FULFILL_STATUS.REACHED_PICKUP,
        DELIVERY_FULFILL_STATUS.PICKED_UP,
        DELIVERY_FULFILL_STATUS.OUT_FOR_DELIVERY,
        DELIVERY_FULFILL_STATUS.REACHED_DELIVERY,
        DELIVERY_FULFILL_STATUS.DELIVERED,
    ];
}
