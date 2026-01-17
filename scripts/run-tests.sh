#!/bin/bash

# ============================================
# HYP Load Testing - Test Runner
# ============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
K6_DIR="${PROJECT_DIR}/k6-tests"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Load environment
if [ -f "${PROJECT_DIR}/configs/.env" ]; then
    source "${PROJECT_DIR}/configs/.env"
fi

# Defaults
BASE_URL="${BASE_URL:-http://localhost:8080/api/v2}"
RESTAURANT_ID="${RESTAURANT_ID:-}"
CUSTOMER_ID="${CUSTOMER_ID:-}"
USER_MODE="${USER_MODE:-single}"
USER_COUNT="${USER_COUNT:-1000}"
ORDER_COUNT="${ORDER_COUNT:-1000}"
DASHBOARD=false
K6_CLOUD_TOKEN="${K6_CLOUD_TOKEN:-}"

show_banner() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║           HYP Backend API - Load Testing Suite                 ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

check_k6() {
    if ! command -v k6 &> /dev/null; then
        echo -e "${RED}Error: k6 is not installed${NC}"
        echo "Install: brew install k6 (macOS) or see https://k6.io/docs/"
        exit 1
    fi
    echo -e "${GREEN}✓ k6 $(k6 version | head -1)${NC}"
}

run_test() {
    local test_name=$1
    local test_file=$2

    echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}Running: ${test_name}${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo "Target: ${BASE_URL}"
    echo ""

    # Build k6 command
    local k6_cmd="k6 run"
    k6_cmd+=" --env BASE_URL=\"${BASE_URL}\""
    k6_cmd+=" --env RESTAURANT_ID=\"${RESTAURANT_ID}\""
    k6_cmd+=" --env CUSTOMER_ID=\"${CUSTOMER_ID}\""
    k6_cmd+=" --env USER_MODE=\"${USER_MODE}\""
    k6_cmd+=" --env USER_COUNT=\"${USER_COUNT}\""
    k6_cmd+=" --env ORDER_COUNT=\"${ORDER_COUNT}\""
    k6_cmd+=" --env REPORT_NAME=\"${test_name}\""

    # Add cloud output if token is provided
    if [ -n "$K6_CLOUD_TOKEN" ]; then
        echo -e "${BLUE}☁️  Publishing results to Grafana Cloud${NC}"
        k6_cmd+=" --out cloud"
        export K6_CLOUD_TOKEN
    fi

    if [ "$DASHBOARD" = true ]; then
        echo -e "${BLUE}Dashboard: http://localhost:5665${NC}"
        k6_cmd+=" --out web-dashboard"
        K6_WEB_DASHBOARD=true \
        eval $k6_cmd "\"${K6_DIR}/${test_file}\""
    else
        eval $k6_cmd "\"${K6_DIR}/${test_file}\""
    fi

    local code=$?

    echo ""
    if [ $code -eq 0 ]; then
        echo -e "${GREEN}✓ ${test_name} PASSED${NC}"
    else
        echo -e "${RED}✗ ${test_name} FAILED (exit: ${code})${NC}"
    fi

    # Show where results were published
   if [ -n "$K6_CLOUD_TOKEN" ]; then
        echo -e "\n${BLUE}☁️  Results published to Grafana Cloud k6${NC}"
        echo -e "${CYAN}   View at: https://app.k6.io${NC}"
    fi

    return $code
}

show_help() {
    echo "Usage: $0 <command> [options]"
    echo ""
    echo -e "${CYAN}Test Scenarios:${NC}"
    echo ""
    echo -e "  ${GREEN}Validation:${NC}"
    echo "    smoke            Quick API health check (1 min)"
    echo "    single-order     Single order lifecycle (debug/verify)"
    echo ""
    echo -e "  ${GREEN}Stress Tests (Individual Components):${NC}"
    echo "    menu-stress      Menu browsing stress test (5 min)"
    echo "    login-stress     Login flow stress test (5 min)"
    echo "    order-stress     Order creation stress test (5 min)"
    echo "    tracking-stress  Order tracking stress test (5 min)"
    echo ""
    echo -e "  ${GREEN}Integration Tests:${NC}"
    echo "    user-journey     Complete user flow test (10 min)"
    echo "    lifecycle        Full order lifecycle test (15 min)"
    echo ""
    echo -e "  ${GREEN}Load Tests:${NC}"
    echo "    load             Mixed realistic traffic (20 min)"
    echo "    stress           System breaking point (15 min)"
    echo ""
    echo -e "${CYAN}Options:${NC}"
    echo "    --url URL          API base URL (default: localhost:8080/api/v2)"
    echo "    --restaurant ID    Restaurant ID (required for most tests)"
    echo "    --customer ID      Customer ID"
    echo "    --mode single|multi  User mode for lifecycle test"
    echo "    --users N          Users in pool (default: 1000)"
    echo "    --orders N         Orders to create (default: 1000)"
    echo "    --dashboard        Open web dashboard at localhost:5665"
    echo "    --cloud TOKEN      Publish results to Grafana Cloud k6"
    echo ""
    echo -e "${CYAN}Examples:${NC}"
    echo "    $0 smoke --restaurant 324672"
    echo "    $0 load --restaurant 324672 --cloud YOUR_TOKEN"
    echo "    $0 stress --restaurant 324672 --dashboard"
    echo ""
    echo -e "${CYAN}Environment Variables:${NC}"
    echo "    K6_CLOUD_TOKEN     Set this to auto-publish to Grafana Cloud"
    echo ""
    echo -e "${CYAN}GitHub Actions:${NC}"
    echo "    Set K6_CLOUD_TOKEN as secrets to auto-publish results"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --url) BASE_URL="$2"; shift 2 ;;
        --restaurant) RESTAURANT_ID="$2"; shift 2 ;;
        --customer) CUSTOMER_ID="$2"; shift 2 ;;
        --mode) USER_MODE="$2"; shift 2 ;;
        --users) USER_COUNT="$2"; shift 2 ;;
        --orders) ORDER_COUNT="$2"; shift 2 ;;
        --dashboard) DASHBOARD=true; shift ;;
        --cloud) K6_CLOUD_TOKEN="$2"; shift 2 ;;
        --help|-h) show_help; exit 0 ;;
        *) COMMAND=$1; shift ;;
    esac
done

show_banner
check_k6

echo -e "${BLUE}Configuration:${NC}"
echo "  URL: ${BASE_URL}"
echo "  Restaurant: ${RESTAURANT_ID:-not set}"
[ -n "$CUSTOMER_ID" ] && echo "  Customer: ${CUSTOMER_ID}"
[ "${USER_MODE}" = "multi" ] && echo "  Mode: ${USER_MODE} (Users: ${USER_COUNT}, Orders: ${ORDER_COUNT})"
[ "$DASHBOARD" = true ] && echo "  Dashboard: enabled"
[ -n "$K6_CLOUD_TOKEN" ] && echo "  Cloud: enabled (Grafana Cloud)"

case "${COMMAND:-help}" in
    # Validation
    smoke)
        run_test "smoke" "scenarios/smoke-test.js"
        ;;
    single-order)
        run_test "single-order" "scenarios/single-order-test.js"
        ;;

    # Stress Tests (Individual)
    menu-stress)
        run_test "menu-stress" "scenarios/menu-stress-test.js"
        ;;
    login-stress)
        run_test "login-stress" "scenarios/login-stress-test.js"
        ;;
    order-stress)
        run_test "order-stress" "scenarios/order-stress-test.js"
        ;;
    tracking-stress)
        run_test "tracking-stress" "scenarios/tracking-stress-test.js"
        ;;

    # Integration Tests
    user-journey)
        run_test "user-journey" "scenarios/user-journey-test.js"
        ;;
    lifecycle)
        run_test "lifecycle" "scenarios/order-lifecycle-test.js"
        ;;

    # Load Tests
    load)
        run_test "load" "scenarios/load-test.js"
        ;;
    stress)
        run_test "stress" "scenarios/stress-test.js"
        ;;

    # Help
    *)
        show_help
        exit 1
        ;;
esac

echo -e "\n${GREEN}Test completed!${NC}"
