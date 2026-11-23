-- Database-level integrity for order coordinates and monetary fields.
-- Applied to production project yfgvimcqbtthnrbzbhft on 2026-11-23.

ALTER TABLE public.orders
  ADD CONSTRAINT orders_coordinates_pair_range_check
  CHECK (
    (lat IS NULL AND lng IS NULL)
    OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
  );

ALTER TABLE public.orders
  ADD CONSTRAINT orders_price_nonnegative_check
  CHECK (price_egp IS NULL OR price_egp >= 0);

ALTER TABLE public.orders
  ADD CONSTRAINT orders_deposit_nonnegative_check
  CHECK (deposit_egp >= 0);
