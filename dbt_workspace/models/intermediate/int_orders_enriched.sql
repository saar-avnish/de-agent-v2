-- Stage 2 TDD SQL Skeleton for int_orders_enriched
SELECT
    order_id, customer_id, order_value_tier
FROM {{ ref('stg_orders') }}
