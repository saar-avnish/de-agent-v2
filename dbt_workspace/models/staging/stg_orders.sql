-- Stage 2 TDD SQL Skeleton for stg_orders
SELECT
    order_id, customer_id, amount
FROM {{ source('raw_crm', 'orders') }}
