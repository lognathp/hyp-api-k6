/**
 * K6 Load Testing Configuration
 * HYP Backend API - Main Branch (No Auth)
 */

// Environment Configuration
export const CONFIG = {
    // API Settings - v2 endpoints, no authentication
    BASE_URL: __ENV.BASE_URL || 'http://localhost:8080/api/v2',

    // Test Data - Set these from environment or use defaults
    RESTAURANT_ID: __ENV.RESTAURANT_ID || '',
    CUSTOMER_ID: __ENV.CUSTOMER_ID || '',

    // User mode: 'single' = one user, 'multi' = pool of users
    USER_MODE: __ENV.USER_MODE || 'single',
    USER_COUNT: parseInt(__ENV.USER_COUNT || '1000'),
    ORDER_COUNT: parseInt(__ENV.ORDER_COUNT || '1000'),

    // Fixed OTP for load testing (when env=load on backend)
    LOAD_TEST_OTP: 123456,

    // Request settings
    REQUEST_TIMEOUT: '30s',

    // Thresholds (adjust based on your environment)
    THRESHOLDS: {
        // Response Time Thresholds
        HTTP_REQ_DURATION_P50: 500,   // 500ms - median
        HTTP_REQ_DURATION_P90: 1500,  // 1.5 seconds
        HTTP_REQ_DURATION_P95: 2000,  // 2 seconds
        HTTP_REQ_DURATION_P99: 3000,  // 3 seconds

        // Error Rate
        ERROR_RATE: 0.01,             // 1% max error rate

        // Operation-specific thresholds
        MENU_FETCH_P95: 1000,         // 1 second
        LOGIN_P95: 1500,              // 1.5 seconds
        ORDER_CREATE_P95: 3000,       // 3 seconds
        PAYMENT_P95: 2000,            // 2 seconds
        DELIVERY_P95: 2000,           // 2 seconds

        // Throughput (requests per second) - adjust based on your capacity
        MIN_RPS: 50,                  // Minimum acceptable RPS
        TARGET_RPS: 100,              // Target RPS for normal load

        // Availability
        SUCCESS_RATE: 0.99,           // 99% success rate
    }
};

// Test Scenarios
export const SCENARIOS = {
    smoke: {
        executor: 'constant-vus',
        vus: 1,
        duration: '1m',
    },
    load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '2m', target: 50 },
            { duration: '5m', target: 50 },
            { duration: '2m', target: 100 },
            { duration: '5m', target: 100 },
            { duration: '2m', target: 0 },
        ],
    },
    stress: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '2m', target: 100 },
            { duration: '3m', target: 200 },
            { duration: '3m', target: 300 },
            { duration: '5m', target: 500 },
            { duration: '3m', target: 500 },
            { duration: '2m', target: 0 },
        ],
    },
    spike: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '10s', target: 500 },
            { duration: '1m', target: 500 },
            { duration: '10s', target: 0 },
        ],
    },
    soak: {
        executor: 'constant-vus',
        vus: 100,
        duration: '2h',
    },
    order_flow: {
        executor: 'ramping-arrival-rate',
        startRate: 1,
        timeUnit: '1s',
        preAllocatedVUs: 50,
        maxVUs: 200,
        stages: [
            { duration: '2m', target: 10 },
            { duration: '5m', target: 30 },
            { duration: '2m', target: 10 },
        ],
    },
};

// Base thresholds (always valid - use built-in k6 metrics only)
export const THRESHOLDS = {
    // Response Time Percentiles
    http_req_duration: [
        `p(50)<${CONFIG.THRESHOLDS.HTTP_REQ_DURATION_P50}`,   // Median
        `p(90)<${CONFIG.THRESHOLDS.HTTP_REQ_DURATION_P90}`,   // 90th percentile
        `p(95)<${CONFIG.THRESHOLDS.HTTP_REQ_DURATION_P95}`,   // 95th percentile
        `p(99)<${CONFIG.THRESHOLDS.HTTP_REQ_DURATION_P99}`,   // 99th percentile
    ],
    // Error Rate
    http_req_failed: [`rate<${CONFIG.THRESHOLDS.ERROR_RATE}`],
    // Check Success Rate
    checks: ['rate>0.95'],
};

// Extended thresholds for tests that define custom metrics
// Use these only in tests that create the corresponding Trend metrics
export const CUSTOM_THRESHOLDS = {
    order_creation_duration: `p(95)<${CONFIG.THRESHOLDS.ORDER_CREATE_P95}`,
    menu_fetch_duration: `p(95)<${CONFIG.THRESHOLDS.MENU_FETCH_P95}`,
    payment_duration: `p(95)<${CONFIG.THRESHOLDS.PAYMENT_P95}`,
};

// API Endpoints Reference (v2)
export const ENDPOINTS = {
    // Health
    HEALTH: '/actuator/health',

    // Login/Auth
    LOGIN_OTP: '/login/otp',
    LOGIN_VERIFY: '/login/verify-otp',
    LOGIN_RESEND: (mobile) => `/login/resend-otp/${mobile}`,

    // Restaurant
    RESTAURANT_LIST: '/restaurant',
    RESTAURANT_GET: (id) => `/restaurant/${id}`,

    // Menu
    CATEGORY_LIST: '/category',
    CATEGORY_GET: (id) => `/category/${id}`,
    ITEM_LIST: '/item',
    ITEM_GET: (id) => `/item/${id}`,
    ITEM_VARIATIONS: (id) => `/item/${id}/variations`,
    ITEM_ADDONS: (id) => `/item/${id}/addons`,
    ADDON_GROUP_LIST: '/addon-group',
    ADDON_GROUP_ITEMS: '/addon-group/items',
    VARIATION_LIST: '/variation',
    MENU_CATEGORY: (restaurantId) => `/menu/category?restaurantId=${restaurantId}`,

    // Order
    ORDER_LIST: '/order',
    ORDER_GET: (id) => `/order/${id}`,
    ORDER_CREATE: '/order',
    ORDER_UPDATE: (id) => `/order/${id}`,
    ORDER_TRACK: (id) => `/order/track/${id}`,

    // Customer
    CUSTOMER_LIST: '/customer',
    CUSTOMER_GET: (id) => `/customer/${id}`,
    CUSTOMER_CREATE: '/customer',

    // Address
    ADDRESS_LIST: '/address',
    ADDRESS_CREATE: '/address',

    // Delivery
    DELIVERY_QUOTE: (restaurantId) => `/delivery/quote/${restaurantId}`,
    DELIVERY_CREATE: (orderId) => `/delivery/create/${orderId}`,
    DELIVERY_FULFILL: (orderId) => `/delivery/fulfill/${orderId}`,
    DELIVERY_STATUS: (orderId) => `/delivery/status/${orderId}`,
    DELIVERY_CONSUME: (orderId) => `/delivery/consume/${orderId}`,
    DELIVERY_CALLBACK: '/delivery/callback',
    DELIVERY_RIDER_LOCATION: (orderId) => `/delivery/rider-location/${orderId}`,

    // Payment
    PAYMENT_CREATE: (orderId) => `/payment/${orderId}`,
    PAYMENT_VERIFY: (orderId) => `/payment/verify/${orderId}`,
    PAYMENT_PROCESS: (orderId) => `/payment/process/${orderId}`,
    PAYMENT_CONSUME: (orderId) => `/payment/consume/${orderId}`,
    PAYMENT_CALLBACK: '/payment/callback',

    // Other
    OFFER_LIST: '/offer',
    FEE_LIST: '/fee',
    ORDER_TYPE_LIST: '/order-type',
    CONTENT_LIST: '/content',
    FEEDBACK_LIST: '/feedback',


    // POS
    POS_ORDER_UPDATE: '/pos/order/callback',
};
