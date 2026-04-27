ALTER TABLE sales
  ADD COLUMN client_sale_id VARCHAR(64) NULL;

ALTER TABLE sales
  ADD UNIQUE KEY uq_sales_client_sale_id (client_sale_id);
