/**
 * Smoke Test - Quick API Health Validation
 *
 * Quick validation that all critical endpoints are accessible and responding.
 * Run this first before any other tests.
 *
 * Duration: ~1 minute
 * VUs: 1
 *
 * Usage: ./run-tests.sh smoke --restaurant 324672
 */

import { sleep, group, check } from 'k6';
import { Rate } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { CONFIG, ENDPOINTS, THRESHOLDS } from '../config.js';
import { apiGet, apiPost } from '../utils/helpers.js';
import { generateLoginDto, generateVerifyOtpDto } from '../data/test-data.js';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';


const successRate = new Rate('smoke_success_rate');

export const options = {
    vus: 1,
    iterations: 1,
    thresholds: {
        ...THRESHOLDS,
        'smoke_success_rate': ['rate>0.95'],
    },
};

export default function () {
    const results = { passed: 0, failed: 0 };

    // 1. Restaurant Endpoints
    group('2. Restaurant', function () {
        let res = apiGet(ENDPOINTS.RESTAURANT_LIST);
        let passed = check(res, { 'Restaurant list OK': (r) => r.status === 200 });
        updateResults(results, passed);
        console.log(`   Restaurant List: ${passed ? 'PASS' : 'FAIL'}`);

        if (CONFIG.RESTAURANT_ID) {
            res = apiGet(ENDPOINTS.RESTAURANT_GET(CONFIG.RESTAURANT_ID));
            passed = check(res, { 'Restaurant get OK': (r) => r.status === 200 });
            updateResults(results, passed);
            console.log(`   Restaurant Get: ${passed ? 'PASS' : 'FAIL'}`);
        }
    });
    sleep(0.5);

    // 3. Menu Endpoints
    group('3. Menu', function () {
        let res = apiGet(ENDPOINTS.CATEGORY_LIST);
        let passed = check(res, { 'Category list OK': (r) => r.status === 200 });
        updateResults(results, passed);
        console.log(`   Categories: ${passed ? 'PASS' : 'FAIL'}`);

        res = apiGet(ENDPOINTS.ITEM_LIST);
        passed = check(res, { 'Item list OK': (r) => r.status === 200 });
        updateResults(results, passed);
        console.log(`   Items: ${passed ? 'PASS' : 'FAIL'}`);

        if (CONFIG.RESTAURANT_ID) {
            res = apiGet(ENDPOINTS.MENU_CATEGORY(CONFIG.RESTAURANT_ID));
            passed = check(res, { 'Menu category OK': (r) => r.status === 200 });
            updateResults(results, passed);
            console.log(`   Menu Categories: ${passed ? 'PASS' : 'FAIL'}`);
        }

        res = apiGet(ENDPOINTS.ADDON_GROUP_LIST);
        passed = check(res, { 'Addon groups OK': (r) => r.status === 200 });
        updateResults(results, passed);
        console.log(`   Addon Groups: ${passed ? 'PASS' : 'FAIL'}`);
    });
    sleep(0.5);

    // 4. Login Endpoints
    group('4. Login', function () {
        const loginDto = generateLoginDto('Smoke Test', '9800000001');
        let res = apiPost(ENDPOINTS.LOGIN_OTP, loginDto);
        let passed = check(res, { 'OTP request OK': (r) => r.status === 200 });
        updateResults(results, passed);
        console.log(`   OTP Request: ${passed ? 'PASS' : 'FAIL'}`);

        if (passed && CONFIG.RESTAURANT_ID) {
            const verifyDto = generateVerifyOtpDto('9800000001', CONFIG.RESTAURANT_ID, CONFIG.LOAD_TEST_OTP);
            res = apiPost(ENDPOINTS.LOGIN_VERIFY, verifyDto);
            passed = check(res, { 'OTP verify OK': (r) => r.status === 200 });
            updateResults(results, passed);
            console.log(`   OTP Verify: ${passed ? 'PASS' : 'FAIL'}`);
        }
    });
    sleep(0.5);

    // 5. Order Endpoints
    group('5. Orders', function () {
        const res = apiGet(ENDPOINTS.ORDER_LIST);
        const passed = check(res, { 'Order list OK': (r) => r.status === 200 });
        updateResults(results, passed);
        console.log(`   Order List: ${passed ? 'PASS' : 'FAIL'}`);
    });
    sleep(0.5);

    // 6. Customer Endpoints
    group('6. Customers', function () {
        const res = apiGet(ENDPOINTS.CUSTOMER_LIST);
        const passed = check(res, { 'Customer list OK': (r) => r.status === 200 });
        updateResults(results, passed);
        console.log(`   Customer List: ${passed ? 'PASS' : 'FAIL'}`);
    });
    sleep(0.5);

    // 7. Delivery Endpoints
    if (CONFIG.RESTAURANT_ID) {
        group('7. Delivery', function () {
            const res = apiGet(`${ENDPOINTS.DELIVERY_QUOTE(CONFIG.RESTAURANT_ID)}?addressId=106335`);
            const passed = check(res, { 'Delivery quote OK': (r) => r.status === 200 || r.status === 404 });
            updateResults(results, passed);
            console.log(`   Delivery Quote: ${passed ? 'PASS' : 'FAIL'}`);
        });
    }

    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log(`SMOKE TEST RESULTS: ${results.passed} passed, ${results.failed} failed`);
    console.log(`${'='.repeat(50)}`);
}

function updateResults(results, passed) {
    if (passed) {
        results.passed++;
        successRate.add(1);
    } else {
        results.failed++;
        successRate.add(0);
    }
}

export function setup() {
    console.log('='.repeat(50));
    console.log('SMOKE TEST - Quick API Health Validation');
    console.log('='.repeat(50));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'Not set'}`);
    console.log('='.repeat(50));
    return { startTime: Date.now() };
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000;
    console.log(`\nSmoke test completed in ${duration.toFixed(1)} seconds`);
}

export function handleSummary(data) {
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true })
    };
}
