-- Stage 2 TDD SQL Skeleton for fct_orders
SELECT
    order_id, customer_id, net_sales
FROM {{ ref('int_orders_enriched') }}
