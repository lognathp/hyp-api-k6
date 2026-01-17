# HYP Backend API - Load Testing

Comprehensive load testing suite for HYP Backend API v2 (food ordering platform).

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Test Scenarios](#test-scenarios)
- [Configuration](#configuration)
- [Backend Setup for Load Testing](#backend-setup-for-load-testing)
- [Mock Services](#mock-services)
- [Running Tests](#running-tests)
- [Order Lifecycle](#order-lifecycle)
- [Reports](#reports)
- [Troubleshooting](#troubleshooting)

## Quick Start

```bash
# 1. Install k6
brew install k6   # macOS
# or see https://k6.io/docs/getting-started/installation/

# 2. Configure backend for load testing (set env=load in .env)
cd ../hyp-backend-api
echo "env=load" >> .env
mvn spring-boot:run

# 3. Start mock services (separate terminal)
cd ../hyp-mock-services
npm install && npm start
# Or with Docker: docker build -t hyp-mock-services . && docker run -p 8090:8090 hyp-mock-services

# 4. Run smoke test to verify setup
cd ../hyp-api-k6
./run-tests.sh smoke --restaurant 324672

# 5. Run full lifecycle test
./run-tests.sh lifecycle --restaurant 324672
```

## Prerequisites

- **k6** - Load testing tool ([Installation](https://k6.io/docs/getting-started/installation/))
- **HYP Backend API** - Running with `env=load` configuration
- **hyp-mock-services** - Mock gateway for external services ([../hyp-mock-services](../hyp-mock-services))
- **Docker** (optional) - For running mock services in container

## Project Structure

```
hyp-load-testing/
├── src/
│   ├── config.js              # Configuration, endpoints, thresholds
│   ├── utils/helpers.js       # API helper functions
│   ├── data/
│   │   ├── test-data.js       # Test data generators (static + dynamic)
│   │   └── dynamic-data.js    # Dynamic data fetching from API
│   └── scenarios/
│       ├── smoke-test.js           # Quick API validation (1 min)
│       ├── menu-stress-test.js     # Menu browsing stress (5 min)
│       ├── login-stress-test.js    # Login flow stress (5 min)
│       ├── order-stress-test.js    # Order creation stress (5 min)
│       ├── tracking-stress-test.js # Order tracking stress (5 min)
│       ├── user-journey-test.js    # Complete user flow (10 min)
│       ├── order-lifecycle-test.js # Full backend lifecycle (15 min)
│       ├── load-test.js            # Mixed traffic simulation (20 min)
│       └── stress-test.js          # System breaking point (15 min)
├── run-tests.sh               # Test runner script
├── configs/.env               # Environment configuration
```

## Test Scenarios

### Overview

| Category | Scenario | Command | Duration | VUs | Description |
|----------|----------|---------|----------|-----|-------------|
| **Validation** | Smoke | `smoke` | 1 min | 1 | Quick API health check |
| **Stress** | Menu | `menu-stress` | 5 min | 0→200 | Menu browsing stress |
| **Stress** | Login | `login-stress` | 5 min | 0→100 | Login flow stress |
| **Stress** | Order | `order-stress` | 5 min | 0→100 | Order creation stress |
| **Stress** | Tracking | `tracking-stress` | 5 min | 0→200 | Order tracking stress |
| **Integration** | User Journey | `user-journey` | 10 min | 0→50 | Complete user flow |
| **Integration** | Lifecycle | `lifecycle` | 15 min | 0→30 | Full order lifecycle |
| **Load** | Mixed Load | `load` | 20 min | 0→100 | Realistic traffic mix |
| **Load** | Stress | `stress` | 15 min | 0→500 | Find breaking points |

---

### Validation Tests

#### Smoke Test
Quick validation that all critical API endpoints are accessible and responding.

```bash
./run-tests.sh smoke --restaurant 324672
```

**Endpoints tested:**
- Health check
- Restaurant details
- Menu categories
- Login flow (OTP)
- Order list
- Customer list
- Delivery quote

---

### Stress Tests (Individual Components)

#### Menu Stress Test
Stress test menu browsing operations under heavy load.

```bash
./run-tests.sh menu-stress --restaurant 324672
```

**Operations:**
- Full menu fetch with categories and items
- Categories list
- Items list
- Addon groups
- Variations

**Load Pattern:** 0 → 50 → 100 → 150 → 200 → 100 → 0 VUs

---

#### Login Stress Test
Stress test the OTP-based authentication flow.

```bash
./run-tests.sh login-stress --restaurant 324672
```

**Flow:**
1. Request OTP (`POST /login/otp`)
2. Verify OTP (`POST /login/verify-otp`)

**Load Pattern:** 0 → 25 → 50 → 75 → 100 → 50 → 0 VUs

---

#### Order Stress Test
Stress test order creation with online payment.

```bash
./run-tests.sh order-stress --restaurant 324672
```

**Flow:**
1. Login (OTP)
2. Browse menu
3. Create order (CREDIT payment)
4. Create payment
5. Verify payment

**Load Pattern:** 0 → 25 → 50 → 75 → 100 → 50 → 0 VUs

---

#### Tracking Stress Test
Stress test order tracking and status checking.

```bash
./run-tests.sh tracking-stress --restaurant 324672
```

**Operations:**
- Get order details
- Track order status
- Get delivery status
- Get rider location

**Load Pattern:** 0 → 50 → 100 → 150 → 200 → 100 → 0 VUs

---

### Integration Tests

#### User Journey Test
Complete user flow from browsing to payment (frontend perspective).

```bash
./run-tests.sh user-journey --restaurant 324672
```

**Flow:**
1. Browse Menu (categories, items, addons)
2. Login (OTP flow)
3. Address & Delivery Quote
4. Place Order
5. Payment (create + verify)

**Load Pattern:** 0 → 15 → 30 → 50 → 30 → 15 → 0 VUs

---

#### Order Lifecycle Test
Complete order journey through all backend status transitions.

```bash
# Single user mode (ramping VUs)
./run-tests.sh lifecycle --restaurant 324672

# Multi-user mode: specific number of orders
./run-tests.sh lifecycle --restaurant 324672 --mode multi --orders 100

# Custom configuration
./run-tests.sh lifecycle --restaurant 324672 --mode multi --users 500 --orders 500
```

**9-Phase Flow:**
1. Browse Menu
2. Login (OTP)
3. Address & Quote
4. Create Order
5. Payment (create + verify)
6. POS Accept (status → ACCEPTED)
7. Ready for Delivery
8. Delivery (create → fulfill → all callbacks)
9. User Tracking (verify DELIVERED)

**Delivery Callbacks:**
```
OUT_FOR_PICKUP → REACHED_PICKUP → PICKED_UP →
OUT_FOR_DELIVERY → REACHED_DELIVERY → DELIVERED
```

---

### Load Tests

#### Mixed Load Test
Simulates realistic production traffic with mixed operations.

```bash
./run-tests.sh load --restaurant 324672
```

**Traffic Distribution:**
- 40% - Menu browsing
- 25% - Order flow (login → order → payment)
- 20% - Order tracking
- 15% - Other operations (restaurants, customers, etc.)

**Load Pattern:** 0 → 25 → 50 → 100 → 100 → 50 → 0 VUs

---

#### Stress Test
Push the system to find its breaking point.

```bash
./run-tests.sh stress --restaurant 324672
```

**Load Distribution:**
- 30% - Menu operations
- 20% - Login operations
- 25% - Order + Payment
- 15% - Order tracking
- 10% - Mixed operations

**Load Pattern:** 0 → 100 → 200 → 300 → 500 → 500 → 300 → 0 VUs

**Relaxed thresholds:** Up to 20% error rate allowed (finding limits)

---

## Configuration

### Environment Variables

Create `configs/.env`:

```bash
# API Configuration
BASE_URL=http://localhost:8080/api/v2
RESTAURANT_ID=324672
CUSTOMER_ID=100003

# User Mode Configuration (for lifecycle test)
USER_MODE=single          # single | multi
USER_COUNT=1000           # Number of users in pool
ORDER_COUNT=1000          # Number of orders to create
```

### Command Line Options

```bash
./run-tests.sh <command> [options]

Validation:
  smoke             Quick API health check (1 min)

Stress Tests (Individual Components):
  menu-stress       Menu browsing stress test (5 min)
  login-stress      Login flow stress test (5 min)
  order-stress      Order creation stress test (5 min)
  tracking-stress   Order tracking stress test (5 min)

Integration Tests:
  user-journey      Complete user flow test (10 min)
  lifecycle         Full order lifecycle test (15 min)

Load Tests:
  load              Mixed realistic traffic (20 min)
  stress            System breaking point (15 min)

Options:
  --url URL           Override BASE_URL
  --restaurant ID     Set RESTAURANT_ID (required for most tests)
  --customer ID       Set CUSTOMER_ID
  --mode single|multi User mode for lifecycle test
  --users N           Number of users in pool (default: 1000)
  --orders N          Number of orders to create (default: 1000)
  --dashboard         Open web dashboard at localhost:5665
```

## Backend Setup for Load Testing

### 1. Configure Environment

Set `env=load` in your backend `.env` file:

```properties
env=load
```

### 2. What Happens in Load Test Mode

When `env=load` is set, the backend automatically:

| Service | Behavior |
|---------|----------|
| **OTP Service** | Uses fixed OTP: `123456`, skips SMS |
| **Payment Service** | Skips Razorpay, creates mock payments, auto-verifies |
| **Notification Service** | Skips WhatsApp and OneSignal notifications |
| **Delivery Service** | Uses mock Pidge API (if configured) |

### 3. Database Configuration

**Recommended:** Use a separate MongoDB database for load testing.

```properties
spring.data.mongodb.database=hyp_load_test
```

## Mock Services

External service mocks for isolated load testing are provided by [hyp-mock-services](../hyp-mock-services).

### Available Mocks

| Service | Base Path | Description |
|---------|-----------|-------------|
| Pidge | `/mock/pidge` | Delivery partner API |
| PetPooja | `/mock/petpooja` | POS integration API |
| 2Factor SMS | `/mock/otp` | SMS/OTP gateway |

### Start Mock Services

```bash
# Option 1: npm
cd ../hyp-mock-services
npm install && npm start

# Option 2: Docker
cd ../hyp-mock-services
docker build -t hyp-mock-services .
docker run -p 8090:8090 hyp-mock-services
```

Mock services run on port `8090` by default.

### Configure Backend to Use Mocks

Add to your HYP backend `.env` or `application.properties`:

```properties
# Pidge delivery mock
delivery.pidge.url=http://localhost:8090/mock/pidge

# PetPooja POS mock (if applicable)
pos.petpooja.url=http://localhost:8090/mock/petpooja

# SMS/OTP mock (if applicable)
sms.2factor.url=http://localhost:8090/mock/otp
```

## Running Tests

### Recommended Test Sequence

```bash
# 1. Validate API is working
./run-tests.sh smoke --restaurant 324672

# 2. Test individual components
./run-tests.sh menu-stress --restaurant 324672
./run-tests.sh login-stress --restaurant 324672
./run-tests.sh order-stress --restaurant 324672
./run-tests.sh tracking-stress --restaurant 324672

# 3. Test complete flows
./run-tests.sh user-journey --restaurant 324672
./run-tests.sh lifecycle --restaurant 324672

# 4. Load testing
./run-tests.sh load --restaurant 324672

# 5. Find limits
./run-tests.sh stress --restaurant 324672
```

### Multi-User Load Testing

```bash
# 100 orders through full lifecycle
./run-tests.sh lifecycle --restaurant 324672 --mode multi --orders 100

# 1000 users, 2000 orders
./run-tests.sh lifecycle --restaurant 324672 --mode multi --users 1000 --orders 2000
```

### Direct k6 Commands

```bash
# Run with environment variables
k6 run src/scenarios/order-lifecycle-test.js \
  --env RESTAURANT_ID=324672 \
  --env USER_MODE=multi \
  --env ORDER_COUNT=100

# With web dashboard
k6 run --out web-dashboard src/scenarios/order-lifecycle-test.js \
  --env RESTAURANT_ID=324672
```

## Order Lifecycle

The complete order journey tested by `lifecycle` command:

```
┌─────────────────────────────────────────────────────────────────┐
│                     ORDER LIFECYCLE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Phase 1: BROWSE MENU                                            │
│  ├── GET /menu/category         → Fetch menu                    │
│  └── GET /addon-group           → Fetch addons                  │
│                                                                  │
│  Phase 2: LOGIN                                                  │
│  ├── POST /login/otp            → Request OTP                   │
│  └── POST /login/verify-otp     → Verify OTP (fixed: 123456)    │
│                                                                  │
│  Phase 3: ADDRESS & QUOTE                                        │
│  └── GET /delivery/quote        → Get delivery quote            │
│                                                                  │
│  Phase 4: CREATE ORDER                                           │
│  └── POST /order                → Status: CREATED               │
│                                                                  │
│  Phase 5: PAYMENT                                                │
│  ├── POST /payment/{orderId}    → Status: PAYMENT_PENDING       │
│  └── POST /payment/verify/{id}  → Status: PAID                  │
│                                                                  │
│  Phase 6: POS ACCEPT                                             │
│  └── PATCH /order/{orderId}     → Status: ACCEPTED              │
│                                                                  │
│  Phase 7: READY FOR DELIVERY                                     │
│  └── PATCH /order/{orderId}     → Status: READY_FOR_DELIVERY    │
│                                                                  │
│  Phase 8: DELIVERY                                               │
│  ├── POST /delivery/create/{orderId}                            │
│  ├── POST /delivery/fulfill/{orderId}                           │
│  └── POST /delivery/callback    → Simulates rider updates:      │
│      ├── OUT_FOR_PICKUP                                         │
│      ├── REACHED_PICKUP                                         │
│      ├── PICKED_UP                                              │
│      ├── OUT_FOR_DELIVERY                                       │
│      ├── REACHED_DELIVERY                                       │
│      └── DELIVERED                                              │
│                                                                  │
│  Phase 9: USER TRACKING                                          │
│  ├── GET /order/{orderId}       → Confirm Status: DELIVERED     │
│  └── GET /order/track/{orderId} → Track order                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Reports

All tests generate HTML and JSON reports automatically.

### Report Files

Reports are saved to `reports/` directory:

| File | Description |
|------|-------------|
| `{test}_{timestamp}.html` | Interactive HTML report |
| `{test}_{timestamp}_summary.json` | JSON summary data |
| `{test}_{timestamp}.json` | Full metrics data (when using --out json) |

### Example Output

```
reports/
├── smoke_20241215T103045.html
├── smoke_20241215T103045_summary.json
├── menu-stress_20241215T110000.html
├── menu-stress_20241215T110000_summary.json
├── lifecycle_20241215T120000.html
└── lifecycle_20241215T120000_summary.json
```

### Web Dashboard

Use the `--dashboard` flag to open a real-time web dashboard:

```bash
./run-tests.sh smoke --dashboard
./run-tests.sh lifecycle --restaurant 324672 --dashboard

# Dashboard opens at http://localhost:5665
```

## Custom Metrics

Each test tracks specific metrics:

### Stress Tests
- `{operation}_duration` - Response time trend
- `{operation}_success_rate` - Success rate
- `requests_per_second` - Throughput

### Integration Tests
- `menu_browse_duration` - Menu browsing time
- `login_duration` - Login flow time
- `order_duration` - Order creation time
- `payment_duration` - Payment flow time
- `total_journey_duration` / `total_lifecycle_duration` - End-to-end time

### Load Tests
- `overall_success_rate` - Combined success rate
- `orders_created` / `orders_completed` - Order counts
- Per-operation success rates and durations

## Troubleshooting

### Common Issues

#### 1. "OTP verification failed"
- **Cause:** Backend not in load test mode
- **Fix:** Ensure `env=load` is set in backend `.env`

#### 2. "Restaurant not found"
- **Cause:** Invalid restaurant ID
- **Fix:** Use a valid restaurant ID: `--restaurant 324672`

#### 3. "Menu fetch failed"
- **Cause:** Restaurant has no menu configured
- **Fix:** Ensure restaurant has menu items in database

#### 4. "Delivery creation failed"
- **Cause:** Mock Pidge service not running
- **Fix:** Start mock services: `docker-compose up -d`

#### 5. "Payment verification failed"
- **Cause:** Backend not skipping Razorpay
- **Fix:** Ensure `env=load` enables `isLoadTest()` in PaymentService

#### 6. "HTML reports not generated"
- **Cause:** Missing handleSummary function
- **Fix:** All tests now include handleSummary with k6-reporter

### Verify Backend Configuration

```bash
# Check if API is accessible
curl http://localhost:8080/api/v2/actuator/health

# Test OTP with fixed value
curl -X POST http://localhost:8080/api/v2/login/otp \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","mobile":"9800000001"}'

curl -X POST http://localhost:8080/api/v2/login/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"mobile":"9800000001","restaurantId":"324672","otp":123456}'
```

## API Endpoints Reference

All tests use `/api/v2` endpoints:

| Category | Endpoint | Method | Description |
|----------|----------|--------|-------------|
| Health | `/actuator/health` | GET | API health check |
| Login | `/login/otp` | POST | Request OTP |
| Login | `/login/verify-otp` | POST | Verify OTP |
| Menu | `/menu/category` | GET | Get menu categories |
| Menu | `/category` | GET | Get categories list |
| Menu | `/item` | GET | Get items list |
| Menu | `/addon-group` | GET | Get addon groups |
| Restaurant | `/restaurant/{id}` | GET | Get restaurant |
| Order | `/order` | POST | Create order |
| Order | `/order/{id}` | GET | Get order |
| Order | `/order/{id}` | PATCH | Update order status |
| Order | `/order/track/{id}` | GET | Track order |
| Payment | `/payment/{orderId}` | POST | Create payment |
| Payment | `/payment/verify/{orderId}` | POST | Verify payment |
| Delivery | `/delivery/quote/{restaurantId}` | GET | Get delivery quote |
| Delivery | `/delivery/create/{orderId}` | POST | Create delivery |
| Delivery | `/delivery/fulfill/{orderId}` | POST | Fulfill delivery |
| Delivery | `/delivery/callback` | POST | Delivery status callback |
| Delivery | `/delivery/status/{orderId}` | GET | Get delivery status |
| Delivery | `/delivery/rider-location/{orderId}` | GET | Get rider location |

See `src/config.js` for the complete endpoint list.

## License

Internal use only - HYP Backend API Load Testing Suite.
