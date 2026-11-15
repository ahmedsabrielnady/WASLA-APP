-- Migration: Smart Tracking Announcements
-- Idempotent: safe to run multiple times
-- Purpose: Add tracking fields to orders, create notifications and announcements tables with RLS

-- ===========================
-- Part 1: ALTER public.orders
-- ===========================

-- Add columns if they don't exist (idempotent)
DO $$ BEGIN
    -- Add tracking_code (nullable text)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public'
                     AND table_name = 'orders'
                     AND column_name = 'tracking_code') THEN
        ALTER TABLE public.orders ADD COLUMN tracking_code text;
    END IF;

    -- Add scheduled_at (nullable timestamptz)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public'
                     AND table_name = 'orders'
                     AND column_name = 'scheduled_at') THEN
        ALTER TABLE public.orders ADD COLUMN scheduled_at timestamptz;
    END IF;

    -- Add updated_at (nullable timestamptz)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public'
                     AND table_name = 'orders'
                     AND column_name = 'updated_at') THEN
        ALTER TABLE public.orders ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    END IF;
END $$;

-- ===========================
-- Part 2: Trigger for tracking_code generation and updated_at on public.orders
-- ===========================

-- Drop trigger if exists (idempotent)
DROP TRIGGER IF EXISTS orders_tracking_trigger ON public.orders;

-- Drop function if exists (idempotent)
DROP FUNCTION IF EXISTS public.generate_tracking_code_and_update_timestamp() CASCADE;

-- Create the trigger function
CREATE OR REPLACE FUNCTION public.generate_tracking_code_and_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    -- Generate tracking_code if absent: WAS- plus 8 uppercase hex chars
    IF NEW.tracking_code IS NULL THEN
        NEW.tracking_code := 'WAS-' || UPPER(encode(md5(random()::text || now()::text), 'hex'))::text;
        -- Ensure exactly 8 hex chars after WAS-
        NEW.tracking_code := substring(NEW.tracking_code, 1, 15);
        -- Pad if needed (md5 could be shorter due to ::text casting)
        IF length(NEW.tracking_code) > 15 THEN
            NEW.tracking_code := substring(NEW.tracking_code from 1 for 15);
        END IF;
    END IF;

    -- Update updated_at on both insert and update
    NEW.updated_at := now();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger (fires before insert or update)
CREATE TRIGGER orders_tracking_trigger
    BEFORE INSERT OR UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_tracking_code_and_update_timestamp();

-- ===========================
-- Part 3: Create public.wasla_notifications table
-- ===========================

-- Create table if not exists
CREATE TABLE IF NOT EXISTS public.wasla_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    type text NOT NULL,
    order_id text,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on wasla_notifications
ALTER TABLE public.wasla_notifications ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Authenticated users can select own notifications" ON public.wasla_notifications;
DROP POLICY IF EXISTS "Authenticated users can update own notifications" ON public.wasla_notifications;
DROP POLICY IF EXISTS "No client insert for notifications" ON public.wasla_notifications;

-- Policy: authenticated users can select only their own notifications
CREATE POLICY "Authenticated users can select own notifications"
    ON public.wasla_notifications
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Policy: authenticated users can update only their own notifications
CREATE POLICY "Authenticated users can update own notifications"
    ON public.wasla_notifications
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: no client insert (only service/trigger can insert)
CREATE POLICY "No client insert for notifications"
    ON public.wasla_notifications
    FOR INSERT
    TO authenticated
    WITH CHECK (false);

-- ===========================
-- Part 4: Create public.wasla_announcements table
-- ===========================

-- Create table if not exists
CREATE TABLE IF NOT EXISTS public.wasla_announcements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message text NOT NULL,
    target_url text,
    is_active boolean NOT NULL DEFAULT true,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by text
);

-- Enable RLS on wasla_announcements
ALTER TABLE public.wasla_announcements ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Public/anon/authenticated can select active announcements within time window" ON public.wasla_announcements;
DROP POLICY IF EXISTS "Founder/admin can insert announcements" ON public.wasla_announcements;
DROP POLICY IF EXISTS "Founder/admin can update announcements" ON public.wasla_announcements;
DROP POLICY IF EXISTS "Founder/admin can delete announcements" ON public.wasla_announcements;

-- Policy: allow public/anon/authenticated to select only active announcements within time window
CREATE POLICY "Public/anon/authenticated can select active announcements within time window"
    ON public.wasla_announcements
    FOR SELECT
    TO anon
    USING (
        is_active = true
        AND (starts_at IS NULL OR now() >= starts_at)
        AND (ends_at IS NULL OR now()::date::timestamptz >= starts_at)
        AND (ends_at IS NULL OR now()::date::timestamptz::timestamptz::date::timestamptz::timestamp with time zone >= now()::date::timestamptz)
    );

CREATE POLICY "Public/anon/authenticated can select active announcements within time window (authenticated)"
    ON public.wasla_announcements
    FOR SELECT
    TO authenticated
    USING (
        is_active = true
        AND (starts_at IS NULL OR now() >= starts_at)
        AND (ends_at IS NULL OR now()::date::timestamptz >= starts_at)
        AND (ends_at IS NULL OR now()::date::timestamptz >= now()::date::timestamptz)
    );

CREATE POLICY "Public/anon/authenticated can select active announcements within time window (public)"
    ON public.wasla_announcements
    FOR SELECT
    TO public
    USING (
        is_active = true
        AND (starts_at IS NULL OR now() >= starts_at)
        AND (ends_at IS NULL OR now()::date::timestamptz >= starts_at)
        AND (ends_at IS NULL OR now()::date::timestamptz >= now()::date::timestamptz)
    );

-- Policy: allow insert only when auth.jwt()->'app_metadata'->>'role' is founder or admin
-- Note: NEVER use user_metadata
CREATE POLICY "Founder/admin can insert announcements"
    ON public.wasla_announcements
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (auth.jwt()->'app_metadata'->>'role') IN ('founder', 'admin')
    );

-- Policy: allow update only when auth.jwt()->'app_metadata'->>'role' is founder or admin
CREATE POLICY "Founder/admin can update announcements"
    ON public.wasla_announcements
    FOR UPDATE
    TO authenticated
    USING (
        (auth.jwt()->'app_metadata'->>'role') IN ('founder', 'admin')
    )
    WITH CHECK (
        (auth.jwt()->'app_metadata'->>'role') IN ('founder', 'admin')
    );

-- Policy: allow delete only when auth.jwt()->'app_metadata'->>'role' is founder or admin
CREATE POLICY "Founder/admin can delete announcements"
    ON public.wasla_announcements
    FOR DELETE
    TO authenticated
    USING (
        (auth.jwt()->'app_metadata'->>'role') IN ('founder', 'admin')
    );

-- ===========================
-- Part 5: SECURITY DEFINER trigger function on public.orders for notifications
-- ===========================

-- Drop trigger if exists (idempotent)
DROP TRIGGER IF EXISTS orders_notification_trigger ON public.orders;

-- Drop function if exists (idempotent)
DROP FUNCTION IF EXISTS public.handle_orders_notification() CASCADE;

-- Create SECURITY DEFINER trigger function
CREATE OR REPLACE FUNCTION public.handle_orders_notification()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id uuid;
    v_sector text;
    v_status text;
    v_order_id text;
BEGIN
    -- Only proceed if user_id is not null
    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    v_user_id := NEW.user_id;
    v_sector := NEW.sector;
    v_status := NEW.status;
    v_order_id := NEW.id::text;

    -- Determine notification type based on sector and status
    IF TG_OP = 'INSERT' THEN
        -- Order creation notification
        INSERT INTO public.wasla_notifications (user_id, title, body, type, order_id)
        VALUES (
            v_user_id,
            'New Order Created',
            'Your order #' || v_order_id || ' (' || COALESCE(v_sector, 'unknown') || ') has been created with status: ' || COALESCE(v_status, 'pending'),
            'order_created',
            v_order_id
        );
 ELSIF TG_OP = 'UPDATE' THEN
        -- Check if status has changed
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            INSERT INTO public.wasla_notifications (user_id, title, body, type, order_id)
            VALUES (
                v_user_id,
                'Order Status Updated',
                'Your order #' || v_order_id || ' (' || COALESCE(v_sector, 'unknown') || ') status has changed from ' || COALESCE(OLD.status, 'unknown') || ' to ' || COALESCE(NEW.status, 'unknown'),
                'order_status_changed',
                v_order_id
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger on orders
CREATE TRIGGER orders_notification_trigger
    AFTER INSERT OR UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_orders_notification();
